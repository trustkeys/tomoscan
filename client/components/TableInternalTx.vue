<template>
    <div
        v-if="loading"
        :class="(loading ? 'tomo-loading tomo-loading--full' : '')"/>
    <section v-else>

        <div
            v-if="total == 0"
            class="tomo-empty">
            <i class="fa fa-exchange tomo-empty__icon"/>
            <p class="tomo-empty__description">No internal transaction found</p>
        </div>

        <p
            v-if="total > 0"
            class="tomo-total-items">
            {{ _nFormatNumber('internal transaction', 'internal transactions', total) }}</p>

        <table-base
            v-if="total > 0"
            :fields="fields"
            :items="items"
            class="tomo-table--internal-transactions">
            <template
                slot="hash"
                slot-scope="props">
                <nuxt-link
                    :to="{name: 'txs-slug', params: {slug: props.item.hash}}"
                    class="text-truncate">
                    {{ props.item.hash }}</nuxt-link>
            </template>

            <template
                slot="block"
                slot-scope="props">
                <nuxt-link
                    :to="{name: 'blocks-slug', params: {slug: props.item.blockNumber}}">
                    {{ props.item.blockNumber }}</nuxt-link>
            </template>

            <template
                slot="timestamp"
                slot-scope="props">
                <span
                    v-b-tooltip.hover
                    :title="$moment(props.item.timestamp).format('lll')">
                    {{ $moment(props.item.timestamp).fromNow() }}</span>
            </template>

            <template
                slot="from"
                slot-scope="props">
                <span
                    v-if="address === props.item.from"
                    class="text-truncate">{{ props.item.from }}</span>
                <nuxt-link
                    v-else
                    :to="{name: 'address-slug', params: {slug: props.item.from}}"
                    class="text-truncate">{{ props.item.from }}</nuxt-link>
            </template>

            <template
                slot="to"
                slot-scope="props">
                <span
                    v-if="address === props.item.to"
                    class="text-truncate">{{ props.item.to }}</span>
                <nuxt-link
                    v-else
                    :to="{name: 'address-slug', params:{slug: props.item.to}}"
                    class="text-truncate">{{ props.item.to }}</nuxt-link>
            </template>

            <template
                slot="value"
                slot-scope="props">{{ formatUnit(toTomo(props.item.value)) }}</template>

        </table-base>

        <b-pagination-nav
            v-if="total > 0 && total > perPage"
            v-model="currentPage"
            :total-rows="total"
            :number-of-pages="pages"
            :per-page="perPage"
            :link-gen="linkGen"
            :limit="7"
            align="center"
            class="tomo-pagination"
            @change="onChangePaginate"
        />
    </section>
</template>

<script>
import mixin from '~/plugins/mixin'
import TableBase from '~/components/TableBase'

export default {
    components: {
        TableBase
    },
    mixins: [mixin],
    head () {
        return {
            title: 'Internal transaction'
        }
    },
    props: {
        address: {
            type: String,
            default: ''
        },
        page: {
            type: Object,
            default: () => {
                return {}
            }
        },
        parent: {
            type: String,
            default: ''
        }
    },
    data: () => ({
        fields: {
            hash: { label: 'Parent TxHash' },
            block: { label: 'Block' },
            timestamp: { label: 'Age' },
            from: { label: 'From' },
            to: { label: 'To' },
            value: { label: 'Value', cssClass: 'pr-lg-4' }
        },
        loading: true,
        pagination: {},
        total: 0,
        items: [],
        currentPage: 1,
        perPage: 20,
        pages: 1,
        blockNumber: null
    }),
    watch: {
        $route (to, from) {
            const page = this.$route.query.page
            this.onChangePaginate(page)
        }
    },
    async mounted () {
        let self = this
        self.getDataFromApi()
    },
    methods: {
        async getDataFromApi () {
            let self = this

            // Show loading.
            self.loading = true

            self.currentPage = parseInt(this.$route.query.page)

            let params = {
                page: self.currentPage || 1,
                limit: self.perPage
            }

            let query = this.serializeQuery(params)
            let { data } = await this.$axios.get('/api/txs/internal/' + self.address + '?' + query)
            self.total = data.total || (data.items || []).length
            self.currentPage = data.currentPage
            self.pages = data.pages

            if (data.items.length === 0) {
                self.loading = false
            }
            if (self.page) {
                self.page.txsCount = self.total
            }

            data.items.forEach(async (item, index, array) => {
                if (index === array.length - 1) {
                    self.items = array

                    // Format data.
                    self.items = self.formatData(self.items, null)

                    // Hide loading.
                    self.loading = false
                }
            })

            return data
        },
        formatData (items = [], blockTimestamp) {
            let _items = []
            items.forEach((item) => {
                let _item = item

                // Format for timestamp.
                if (blockTimestamp) {
                    _item.timestamp = blockTimestamp
                } else if (!item.block) {
                    if (item.timestamp) {
                        _item.timestamp = item.timestamp
                    } else {
                        _item.timestamp = item.createdAt
                    }
                } else {
                    _item.timestamp = item.block.timestamp
                }

                _items.push(_item)
            })

            return _items
        },
        onChangePaginate (page) {
            let self = this
            self.currentPage = page

            self.getDataFromApi()
        },
        linkGen (pageNum) {
            return {
                query: {
                    page: pageNum
                },
                hash: this.parent
            }
        }
    }
}
</script>
