import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire('/Users/zhuangjiaxuan/.nvm/versions/node/v24.12.0/lib/node_modules/openfilm/')
const { chromium } = require('playwright-core')

const source = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
const match = source.match(/async function webmToPcm16k[\s\S]*?\n    \}/)
if (!match) { console.error('function not found in client.js'); process.exit(1) }

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<html></html>')
const result = await page.evaluate((fn) => {
  class FakeAudioContext {
    constructor() { this.sampleRate = 16000 }
    async decodeAudioData() {
      const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])
      return { getChannelData: () => samples }
    }
    close() {}
  }
  globalThis.AudioContext = FakeAudioContext
  eval(fn)
  return webmToPcm16k(new ArrayBuffer(8)).then((buf) => {
    const view = new DataView(buf)
    return {
      riff: Array.from(new Uint8Array(buf, 0, 4)).map((b) => String.fromCharCode(b)).join(''),
      wave: Array.from(new Uint8Array(buf, 8, 4)).map((b) => String.fromCharCode(b)).join(''),
      byteRate: view.getUint32(28, true),
      dataLen: view.getUint32(40, true),
      totalLen: buf.byteLength,
      samples: [0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true)),
    }
  })
}, match[0])
await browser.close()

const expect = (name, actual, wanted) => { if (actual !== wanted) { console.error(`✗ ${name}: ${actual} ≠ ${wanted}`); process.exit(1) } console.log(`✓ ${name} = ${actual}`) }
expect('riff', result.riff, 'RIFF')
expect('wave', result.wave, 'WAVE')
expect('byteRate', result.byteRate, 32000)
expect('dataLen', result.dataLen, 12)
expect('totalLen', result.totalLen, 56)
expect('samples', JSON.stringify(result.samples), JSON.stringify([0, 16383, -16384, 32767, -32768, 8191]))
console.log('WAV_OK')
