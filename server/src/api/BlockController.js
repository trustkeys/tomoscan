import { Router } from 'express'
import _ from 'lodash'
import async from 'async'
import Setting from '../models/Setting'
import Block from '../models/Block'
import { paginate } from '../helpers/utils'
import Web3Util from '../helpers/web3'
import BlockRepository from '../repositories/BlockRepository'

const BlockController = Router()

BlockController.get('/blocks', async (req, res, next) => {
  try {
    let per_page = !isNaN(req.query.limit) ? parseInt(req.query.limit) : 10
    let page = !isNaN(req.query.page) ? parseInt(req.query.page) : 1
    per_page = Math.min(25, per_page)
    let calc_page = page * per_page

    let web3 = await Web3Util.getWeb3()
    // Get latest block number count.
    let max_block_number = await web3.eth.getBlockNumber()
    let offset = max_block_number - calc_page
    let block_numbers = [], remain_numbers = []

    if (calc_page - max_block_number < per_page) {
      let max = offset + per_page
      max = max < max_block_number ? max : max_block_number
      block_numbers = _.range(offset, max)
      let exists_numbers = await Block.distinct('number',
        {number: {$in: block_numbers}})
      remain_numbers = _.xor(block_numbers, exists_numbers)
    }

    // Insert blocks remain.
    async.each(remain_numbers, async (number, next) => {
      if (number) {
        let e = await BlockRepository.addBlockByNumber(number)
        if (!e) next(e)

        next()
      }
    }, async (e) => {
      if (e) throw e

      let params = {query: {number: {$in: block_numbers}}, sort: {number: -1}}
      if (max_block_number) {
        params.total = max_block_number
      }
      // Check filter type.
      if (req.query.filter) {
        switch (req.query.filter) {
          case 'latest':
            params.sort = {number: -1}
            break
        }
      }
      // Check specific latest block number in request.
      if (req.query.to) {
        params.query = {}
      }
      let data = await paginate(req, 'Block', params, true)

      return res.json(data)
    })
  }
  catch (e) {
    console.log(e)
    throw e
  }
})

BlockController.get('/blocks/:slug', async (req, res) => {
  try {
    let hashOrNumb = req.params.slug
    let query = {}
    if (_.isNumber(hashOrNumb)) {
      query = {number: hashOrNumb}
    }
    else {
      query = {hash: hashOrNumb}
    }

    // Find exist in db.
    let block = await Block.findOne(query)
    if (!block) {
      block = await BlockRepository.addBlockByNumber(hashOrNumb)
    }

    return res.json(block)
  }
  catch (e) {
    console.log(e)
    throw e
  }
})

export default BlockController