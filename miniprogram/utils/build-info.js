'use strict'
const version = '1.4.159'
function label () {
  let environment = ''
  try { environment = wx.getAccountInfoSync().miniProgram.envVersion } catch (_) {}
  return version + ' · ' + ({ develop: '开发版', trial: '体验版', release: '正式版' }[environment] || '本地测试')
}
module.exports = { version, label }
