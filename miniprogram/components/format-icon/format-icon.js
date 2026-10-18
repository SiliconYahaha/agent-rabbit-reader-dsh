const icons = { HTML: 'html', SVG: 'svg', Ai: 'ai', PSD: 'psd', ZIP: 'zip', MD: 'markdown', FIG: 'design', CAD: 'cad', CDR: 'design', PDF: 'pdf', DOC: 'office', IMG: 'image', MP3: 'audio', MP4: 'video', DATA: 'data', '</>': 'code', TXT: 'text', '＋': 'more' }
Component({
  properties: { label: { type: String, value: 'FILE' } },
  data: { source: '/assets/format-icons/text.svg' },
  observers: { label (value) { this.setData({ source: '/assets/format-icons/' + (icons[value] || 'text') + '.svg' }) } }
})
