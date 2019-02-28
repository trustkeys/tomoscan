const { Router } = require('express')
const db = require('../models')
const TransactionHelper = require('../helpers/transaction')
const Web3Util = require('../helpers/web3')
const TokenTransactionHelper = require('../helpers/tokenTransaction')
const utils = require('../helpers/utils')
const config = require('config')

const contractAddress = require('../contracts/contractAddress')
const accountName = require('../contracts/accountName')
const logger = require('../helpers/logger')
const { check, validationResult } = require('express-validator/check')

const TxController = Router()

TxController.get('/txs', [
    check('limit').optional().isInt({ max: 100 }).withMessage('Limit is less than 101 items per page'),
    check('page').optional().isInt({ max: 500 }).withMessage('Require page is number'),
    check('address').optional().isLength({ min: 42, max: 42 }).withMessage('Account address is incorrect.'),
    check('block').optional().isInt().withMessage('Require page is number'),
    check('type').optional().isString().withMessage('type = signTxs|otherTxs|pending'),
    check('tx_account').optional().isString().withMessage('type = in|out. if equal null return all')
], async (req, res) => {
    let errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }

    let params = { sort: { blockNumber: -1 }, query: {} }
    let limitedRecords = config.get('LIMITED_RECORDS')
    let start = new Date()
    try {
        let perPage = !isNaN(req.query.limit) ? parseInt(req.query.limit) : 25
        let page = !isNaN(req.query.page) ? parseInt(req.query.page) : 1
        let offset = page > 1 ? (page - 1) * perPage : 0

        let blockNumber = !isNaN(req.query.block) ? req.query.block : null
        let address = req.query.address
        let specialAccount = null
        let total = null
        let type = req.query.type
        let txAccount = req.query.tx_account
        let isBlock = false

        if (typeof address !== 'undefined') {
            address = address.toLowerCase()
            if (txAccount === 'in') {
                params.query = Object.assign({}, params.query, { to: address })
            } else if (txAccount === 'out') {
                params.query = Object.assign({}, params.query, { from: address })
            } else {
                params.query = Object.assign({}, params.query, { $or: [{ from: address }, { to: address }] })
            }
        } else if (blockNumber) {
            params.query = Object.assign({}, params.query, { blockNumber: blockNumber })
            isBlock = true
        } else if (type) {
            let condition
            if (type === 'signTxs') {
                specialAccount = 'signTransaction'
                condition = { to: contractAddress.BlockSigner, isPending: false }
            } else if (type === 'otherTxs') {
                specialAccount = 'otherTransaction'
                condition = { to: { $nin: [contractAddress.BlockSigner, contractAddress.TomoRandomize] },
                    isPending: false }
            } else if (type === 'pending') {
                specialAccount = 'pendingTransaction'
                condition = { isPending: true }
                params.sort = { createdAt: -1 }
            } else if (type === 'all') {
                specialAccount = 'allTransaction'
                params.query = Object.assign({}, params.query, { isPending: false })
            }

            params.query = Object.assign({}, params.query, condition || {})
        } else {
            specialAccount = 'allTransaction'
            params.query = Object.assign({}, params.query, { isPending: false })
        }

        if (specialAccount != null) {
            let sa = await db.SpecialAccount.findOne({ hash: specialAccount })
            if (sa) {
                total = sa.totalTransactionCount
            }
        }
        let end = new Date() - start
        logger.info(`Txs preparation execution time: %dms`, end)
        start = new Date()
        if (total === null) {
            total = 0 // await db.Tx.countDocuments(params.query)
            end = new Date() - start
            logger.info(`Txs count execution time: %dms query %s`, end, JSON.stringify(params.query))
        }
        start = new Date()

        let data = {}
        let getOnChain = false
        if (isBlock) {
            let block = await db.Block.findOne({ number: blockNumber })
            if (block === null || block.e_tx > total) {
                getOnChain = true
                const web3 = await Web3Util.getWeb3()

                const _block = await web3.eth.getBlock(blockNumber)

                const trans = _block.transactions
                let countTx = trans.length
                const items = []
                let txids = []
                for (let i = offset; i < (offset + perPage); i++) {
                    if (i < trans.length) {
                        txids.push(trans[i])
                    } else {
                        break
                    }
                }
                let map = txids.map(async function (tx) {
                    items.push(await TransactionHelper.getTransaction(tx))
                })
                await Promise.all(map)
                const pages = Math.ceil(trans.length / perPage)
                data = {
                    realTotal: countTx,
                    total: countTx > limitedRecords ? limitedRecords : countTx,
                    perPage: perPage,
                    currentPage: page,
                    pages: pages,
                    items: items
                }
            }
        }
        end = new Date() - start
        logger.info(`Txs isBlock execution time: %dms`, end)
        start = new Date()

        if (getOnChain === false) {
            let pages = Math.ceil(total / perPage)

            let items = await db.Tx.find(params.query)
                .sort(params.sort)
                .skip(offset).limit(perPage)
                .lean().exec()

            if (pages > 500) {
                pages = 500
            }
            let newTotal = total > limitedRecords ? limitedRecords : total

            data = {
                realTotal: total,
                total: newTotal,
                perPage: perPage,
                currentPage: page,
                pages: pages,
                items: items
            }
            end = new Date() - start
            logger.info(`Txs getOnChain === false execution time: %dms address %s query %s sort %s %s %s`,
                end, address,
                JSON.stringify(params.query),
                JSON.stringify(params.sort),
                offset, perPage)
            start = new Date()
        }

        let listAddress = []
        for (let i = 0; i < data.items.length; i++) {
            let item = data.items[i]
            if (!listAddress.includes(item.from)) {
                listAddress.push(item.from)
            }
            if (item.to && !listAddress.includes(item.to)) {
                listAddress.push(item.to)
            }
        }
        if (listAddress) {
            let newItem = []
            let accounts = await db.Account.find({ hash: { $in: listAddress } })
            let map1 = data.items.map(async function (d) {
                let map2 = accounts.map(async function (ac) {
                    ac = ac.toJSON()
                    ac.accountName = accountName[ac.hash] || null
                    if (d.from === ac.hash) {
                        d.from_model = ac
                    }
                    if (d.to === ac.hash) {
                        d.to_model = ac
                    }
                })
                await Promise.all(map2)
                newItem.push(d)
            })
            await Promise.all(map1)
            data.items = newItem
        }
        let status = []
        for (let i = 0; i < data.items.length; i++) {
            if (!data.items[i].hasOwnProperty('status')) {
                status.push({ hash: data.items[i].hash })
            }
        }
        if (status.length > 0) {
            let map = status.map(async function (s) {
                let receipt = await TransactionHelper.getTransactionReceipt(s.hash)
                if (receipt) {
                    s.status = receipt.status
                } else {
                    s.status = null
                }
            })
            await Promise.all(map)
            for (let i = 0; i < status.length; i++) {
                for (let j = 0; j < data.items.length; j++) {
                    if (status[i].hash === data.items[j].hash) {
                        data.items[j].status = status[i].status
                    }
                }
            }
        }
        end = new Date() - start
        logger.info(`Txs getOnChain execution time: %dms address %s`, end, address)

        return res.json(data)
    } catch (e) {
        logger.warn('cannot get list tx with query %s. Error', JSON.stringify(params.query), e)
        return res.status(500).json({ errors: { message: 'Something error!' } })
    }
})

TxController.get('/txs/:slug', [
    check('slug').exists().isLength({ min: 66, max: 66 }).withMessage('Transaction hash is incorrect.')
], async (req, res) => {
    let errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }
    let hash = req.params.slug
    hash = hash ? hash.toLowerCase() : hash
    try {
        let tx
        try {
            tx = await TransactionHelper.getTxDetail(hash)
        } catch (e) {
            logger.warn('cannot get tx detail. Error', e)
            return res.status(404).json({ errors: { message: 'Transaction is not found!' } })
        }
        if (!tx) {
            return res.status(404).json({ errors: { message: 'Transaction is not found!' } })
        }
        tx.from_model = await db.Account.findOne({ hash: tx.from.toLowerCase() })
        let toModel
        if (tx.to) {
            toModel = await db.Account.findOne({ hash: tx.to.toLowerCase() })
        } else {
            toModel = await db.Account.findOne({ hash: tx.contractAddress.toLowerCase() })
        }
        tx.to_model = toModel

        let tokenTxs = await db.TokenTx.find({ transactionHash: tx.hash })

        tokenTxs = await TokenTransactionHelper.formatTokenTransaction(tokenTxs)
        tx.tokenTxs = tokenTxs

        let web3 = await Web3Util.getWeb3()
        let blk = await web3.eth.getBlock('latest')
        tx.latestBlockNumber = (blk || {}).number || tx.blockNumber
        let input = tx.input
        if (input !== '0x') {
            let method = input.substr(0, 10)
            let stringParams = input.substr(10, input.length - 1)
            let params = []
            for (let i = 0; i < stringParams.length / 64; i++) {
                params.push(stringParams.substr(i * 64, 64))
            }
            let inputData = ''
            if (tx.to && (toModel || {}).isContract) {
                let contract = await db.Contract.findOne({ hash: tx.to.toLowerCase() })
                let functionString = ''
                if (contract) {
                    inputData += 'Function: '
                    let functionHashes = contract.functionHashes
                    let abiCode = JSON.parse(contract.abiCode)
                    Object.keys(functionHashes).map(function (key) {
                        if (method === '0x' + functionHashes[key]) {
                            let methodName = key.indexOf('(') < 0 ? key : key.split('(')[0]
                            functionString += methodName + '('
                            abiCode.map(function (fnc) {
                                if (fnc.name === methodName) {
                                    for (let i = 0; i < fnc.inputs.length; i++) {
                                        let input = fnc.inputs[i]
                                        if (i === 0) {
                                            functionString += `${input.type} ${input.name}`
                                        } else {
                                            functionString += `, ${input.type} ${input.name}`
                                        }
                                    }
                                }
                            })
                            functionString += ')'
                        }
                    })
                } else {
                    if (method === '0xa9059cbb') {
                        functionString = 'Function: transfer(address _to, uint256 _value) ***'
                    }
                }
                inputData += functionString === '' ? '' : functionString + '\n'
            }

            if (tx.to !== null) {
                inputData += 'MethodID: ' + method
                for (let i = 0; i < params.length; i++) {
                    inputData += `\n[${i}]: ${params[i]}`
                }
                tx.inputData = inputData
            }
        }

        return res.json(tx)
    } catch (e) {
        logger.warn('cannot get list tx %s detail. Error %s', hash, e)
        return res.status(500).json({ errors: { message: 'Something error!' } })
    }
})

TxController.get('/txs/internal/:address', [
    check('limit').optional().isInt({ max: 100 }).withMessage('Limit is less than 101 items per page'),
    check('page').optional().isInt().withMessage('Require page is number'),
    check('address').exists().isLength({ min: 42, max: 42 }).withMessage('Account address is incorrect.')

], async (req, res) => {
    let errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }
    let address = req.params.address
    address = address ? address.toLowerCase() : address
    try {
        let data = await utils.paginate(req, 'InternalTx',
            { query: { $or: [{ from: address }, { to: address }] }, sort: { blockNumber: -1 } })
        return res.json(data)
    } catch (e) {
        logger.warn('cannot get list internal tx of address %s. Error %s', address, e)
        return res.status(500).json({ errors: { message: 'Something error!' } })
    }
})

module.exports = TxController
