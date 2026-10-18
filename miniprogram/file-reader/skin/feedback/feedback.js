const build = require('../../../utils/build-info')
Component({
  properties: { name: String, diagnostic: String },
  data: { expanded: false },
  methods: {
    contact () {
      const unavailable = () => this.setData({ expanded: true })
      const profile = () => {
        if (typeof wx.openOfficialAccountProfile !== 'function') return unavailable()
        try { wx.openOfficialAccountProfile({ username: 'gh_b3d8d075cdd6', fail: unavailable }) } catch (_) { unavailable() }
      }
      if (typeof wx.openOfficialAccountChat !== 'function') return profile()
      try { wx.openOfficialAccountChat({ username: 'gh_b3d8d075cdd6', fail: profile }) } catch (_) { profile() }
    },
    toggle () { this.setData({ expanded: !this.data.expanded }) },
    copy () {
      wx.setClipboardData({ data: '兔子阅读器问题反馈\n文件：' + (this.properties.name || '请填写文件名和格式') + '\n版本：' + build.label() + '\n问题：请描述打开过程，并附上截图。' + (this.properties.diagnostic ? '\n诊断：' + this.properties.diagnostic : ''), success () { wx.showToast({ title: '已复制反馈信息', icon: 'none' }) } })
    }
  }
})
