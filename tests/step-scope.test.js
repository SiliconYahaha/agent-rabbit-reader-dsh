'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { readStepRecords, stepReferences } = require('../miniprogram/file-reader/engine/core/step-records')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { readerPage } = require('./helpers/reader-host')
const { rows } = require('./fixtures/step-scope/originals.json')
const base = rows[0].source
const model = { kind: 'step-wireframe', points: [[0, 0, 0], [10, 0, 0]], edges: [[0, 1]], faces: [] }
const inspect = source => inspectFileBytes(Buffer.from(source), { name: 'scope.step' })

test('STEP original comments, names and header strings preserve the independently checked graph', () => {
  for (const row of rows) {
    assert.equal(crypto.createHash('sha256').update(row.source).digest('hex'), row.sha256)
    const parsed = readStepRecords(row.source)
    assert.equal(parsed.records.length, 8, row.name)
    assert.deepEqual(parsed.records.map(r => '#' + r.id).sort(), ['#1', '#2', '#3', '#4', '#5', '#7', '#8', '#9'], row.name)
    assert.deepEqual(inspect(row.source).interactiveModel, model, row.name)
    assert.equal(inspect(row.source).entries.find(r => r.name === 'CARTESIAN_POINT').detail, '2 个实体')
  }
})

test('STEP complex records preserve boundaries, comment separators and reference-free labels', () => {
  const content = base.replace('ENDSEC;END-ISO', "#20=(REPRESENTATION_RELATIONSHIP('name #99; ( )','it''s #88',#3,#4)/* quote ' ) #90= */REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#9));ENDSEC;END-ISO")
  const parsed = readStepRecords(content)
  assert.deepEqual(parsed.complexRecords, [{ id: '20', components: [
    { type: 'REPRESENTATION_RELATIONSHIP', body: "'name #99; ( )','it''s #88',#3,#4" },
    { type: 'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION', body: '#9' }
  ] }])
  assert.deepEqual(stepReferences(parsed.complexRecords[0].components[0].body), ['3', '4'])
  assert.deepEqual(stepReferences("'escaped '' #77',\"0ABC\",(#0003,#4),.T."), ['3', '4'])
})

test('STEP control characters and print directives preserve token and literal semantics', () => {
  for (const separator of ['\n', '\r\n', '\r', '\t', '\f']) {
    const source = base.replace('CARTESIAN_POINT', 'CARTESIAN_' + separator + 'POINT').replace('#1=', '#' + separator + '1=')
    assert.deepEqual(inspect(source).interactiveModel, model)
  }
  for (const separator of ['/* ) quote\' */', '\\N\\', '\\F\\']) {
    for (const needle of ['#1', '=', 'CARTESIAN_POINT']) {
      assert.deepEqual(inspect(base.replace(needle, needle + separator)).interactiveModel, model)
    }
  }
  const withName = name => base.replace("FILE_NAME('scope.step'", "FILE_NAME('" + name + "'")
  const fileName = source => inspect(source).metadata.find(r => r.label === '文件名').value
  assert.equal(fileName(withName("a''b/*literal*/\\N\\c.step")), "a'b/*literal*/c.step")
  assert.equal(fileName(withName('literal\\\\N\\\\.step')), 'literal\\\\N\\\\.step')
  assert.throws(() => inspect(base.replace('CARTESIAN_POINT', 'CARTESIAN_/* separator */POINT')), /STEP/)
})

test('STEP actual data sections and numeric reference identities cannot be forged by strings', () => {
  const multiple = base.replace('#7=DIRECTION', "ENDSEC;DATA('next',('AUTOMOTIVE_DESIGN'));#7=DIRECTION")
  assert.deepEqual(inspect(multiple).interactiveModel, model)
  const leadingZeros = base.replace(/#(\d+)/g, '#000$1')
  assert.deepEqual(inspect(leadingZeros).interactiveModel, model)
  const escaped = base.replace("EDGE_CURVE('',", "EDGE_CURVE('it''s #99; ENDSEC; DATA;',")
  assert.deepEqual(inspect(escaped).interactiveModel, model)
  assert.deepEqual(inspect(base + '/* harmless final note */').interactiveModel, model)
  const userType = base.replace('ENDSEC;END-ISO', "#21=!LOCAL_RECORD('unknown non-geometric record',#1);ENDSEC;END-ISO")
  assert.deepEqual(inspect(userType).interactiveModel, model)
})

test('STEP malformed and unsupported structures fail without publishing a partial model', () => {
  const invalid = [
    base + '/* open', base.replace("CARTESIAN_POINT('',", "CARTESIAN_POINT('open,"),
    base.replace('#1=CARTESIAN_POINT', '#1=CARTESIAN_ POINT'), base.replace('#2=', '#01='),
    base.replace('));#2=', '))#2='), base.replace('ENDSEC;END-ISO', 'END-ISO'),
    base.replace('END-ISO-10303-21;', ''), base + "#99=CARTESIAN_POINT('',(99.,99.,99.));",
    base.replace('DATA;', 'ANCHOR;'), base.replace('#1=CARTESIAN_POINT', '#1=()EXTRA'),
    base.replace('DATA;', "DATA;#66=EMPTY(" + '('.repeat(260) + '0' + ')'.repeat(260) + ');')
  ]
  for (const source of invalid) assert.throws(() => inspect(source), /STEP/)
})

test('STEP failed and stale reads cannot replace the next valid model', async () => {
  const reads = [], host = readerPage({ getFileSystemManager: () => ({ readFile: options => reads.push(options) }) })
  const open = name => host.openSelectedFile({ name: name + '.step', path: '/local/' + name + '.step', size: base.length })
  try {
    open('first'); reads.shift().success({ data: Buffer.from(base) }); await new Promise(setImmediate)
    assert.deepEqual(host._inspectorModel, model)
    open('broken'); reads.shift().success({ data: Buffer.from(base + '/* open') }); await new Promise(setImmediate)
    assert.match(host.data.error, /STEP/); assert.equal(host.data.hasContent, false); assert.equal(host._inspectorModel, null)
    open('stale'); const stale = reads.shift()
    open('current'); reads.shift().success({ data: Buffer.from(base) }); await new Promise(setImmediate)
    stale.success({ data: Buffer.from(rows[1].source) }); await new Promise(setImmediate)
    assert.equal(host.data.error, ''); assert.deepEqual(host._inspectorModel, model)
  } finally { host.detached() }
})
