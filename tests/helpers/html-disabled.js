'use strict'
const controls = [
  ['checkbox', '<input id="target" name="answer" value="yes" type="checkbox" checked>'],
  ['text', '<input id="target" name="answer" value="yes">'],
  ['radio', '<input id="target" name="answer" value="yes" type="radio" checked>'],
  ['textarea', '<textarea id="target" name="answer">yes</textarea>'],
  ['select', '<select id="target" name="answer"><option value="yes" selected>Yes</option></select>'],
  ['submit', '<button id="target" type="submit">Submit</button>'],
  ['reset', '<button id="target" type="reset">Reset</button>']
]
const wrappers = [
  ['enabled', value => `<fieldset>${value}</fieldset>`],
  ['own', value => value.replace('id="target"', 'id="target" disabled="false"')],
  ['fieldset', value => `<fieldset disabled>${value}</fieldset>`],
  ['first-legend', value => `<fieldset disabled><div>Prefix</div><legend>${value}</legend></fieldset>`],
  ['second-legend', value => `<fieldset disabled><legend>First</legend><legend>${value}</legend></fieldset>`],
  ['outer-disabled', value => `<fieldset disabled><fieldset><legend>${value}</legend></fieldset></fieldset>`],
  ['nested-exempt', value => `<fieldset disabled><legend><fieldset disabled><legend>${value}</legend></fieldset></legend></fieldset>`]
]
const samples = controls.flatMap(([control, html]) => wrappers.map(([wrapper, wrap]) => ({ name: `${control}-${wrapper}`, content: wrap(html), hostControl: true })))
for (const [name, content] of [
  ['fieldset-own', '<fieldset disabled id="target"></fieldset>'],
  ['fieldset-inherited', '<fieldset disabled><fieldset id="target"></fieldset></fieldset>'],
  ['option-own', '<select><option disabled id="target">Yes</option></select>'],
  ['option-group', '<select><optgroup disabled><option id="target">Yes</option></optgroup></select>'],
  ['option-select', '<select disabled><option id="target">Yes</option></select>'],
  ['option-fieldset', '<fieldset disabled><select><option id="target">Yes</option></select></fieldset>'],
  ['optgroup-own', '<select><optgroup disabled id="target"><option>Yes</option></optgroup></select>'],
  ['optgroup-select', '<select disabled><optgroup id="target"><option>Yes</option></optgroup></select>'],
  ['optgroup-fieldset', '<fieldset disabled><select><optgroup id="target"><option>Yes</option></optgroup></select></fieldset>'],
  ['div-disabled', '<div disabled id="target">Text</div>'],
  ['output-disabled', '<output disabled id="target">Text</output>']
]) samples.push({ name, content })
for (const multiple of [false, true]) samples.push({
  name: multiple ? 'select-disabled-selected-multiple' : 'select-disabled-selected-single',
  content: `<select id="target" name="answer" ${multiple ? 'multiple' : ''}><optgroup disabled><option selected value="a">Closed</option></optgroup>${multiple ? '<option selected value="b">Open</option>' : ''}</select>`,
  hostControl: !multiple
})
const styles = '#target{color:rgb(0,0,0)}#target:disabled{color:rgb(170,0,0)}#target:enabled{color:rgb(0,100,0)}'
function probe (document, FormData, getComputedStyle) {
  const target = document.getElementById('target'), form = document.getElementById('form')
  let clicks = 0, submits = 0, resets = 0
  target.addEventListener('click', () => clicks++)
  form.addEventListener('submit', event => { submits++; event.preventDefault() })
  form.addEventListener('reset', event => { resets++; event.preventDefault() })
  const before = { own: target.hasAttribute('disabled'), disabled: target.matches(':disabled'), enabled: target.matches(':enabled'), pairs: Array.from(new FormData(form)), color: getComputedStyle(target).color }
  if (/^(input|button|select|textarea|option|optgroup|fieldset)$/.test(target.localName)) before.reflected = target.disabled
  target.click()
  const after = { clicks, submits, resets, pairs: Array.from(new FormData(form)) }
  if (target.localName === 'input') after.checked = target.checked
  return { before, after }
}
function sourceFor (sample) {
  return `<!doctype html><html><head><style>${styles}</style></head><body><form id="form">${sample.content}</form><pre id="out"></pre><script>document.getElementById('out').textContent=JSON.stringify((${probe.toString()})(document,FormData,getComputedStyle));</script></body></html>`
}
const selectionSource = `<!doctype html><select id="s"><optgroup><option value="x">First</option><option value="x">Second</option><option value="" selected>Empty</option></optgroup></select><pre id="out"></pre><script>
const s=document.getElementById('s'), states=[];
function snapshot(){states.push({value:s.value,index:s.selectedIndex,flags:Array.from(s.options).map(o=>o.selected),label:s.options[s.selectedIndex]?.textContent||''})}
snapshot();s.selectedIndex=1;snapshot();s.value='x';snapshot();s.value='';snapshot();s.selectedIndex=-1;snapshot();document.getElementById('out').textContent=JSON.stringify(states);
</script>`
module.exports = { samples, styles, sourceFor, selectionSource }
