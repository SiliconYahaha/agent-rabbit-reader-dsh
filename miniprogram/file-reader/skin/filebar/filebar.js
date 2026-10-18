Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: String, value: '' },
    metadata: { type: Array, value: [] },
    details: { type: Array, value: [] },
    message: { type: String, value: '' }
  },
  data: { expanded: false, extension: 'FILE', build: '' },
  observers: {
    name (name) {
      const match = /\.([a-z0-9]{1,8})$/i.exec(name || '')
      this.setData({ expanded: false, extension: match ? match[1].toUpperCase() : 'FILE' })
    }
  },
  methods: {
    toggle () { this.setData({ expanded: !this.data.expanded, build: require('../../../utils/build-info').label() }) },
    close () { this.setData({ expanded: false }) },
    stopTouch () {}
  }
})
