// 离线自测：只跑字面那一层，不碰宿主。
import { readFileSync } from 'node:fs'
import { collide, renderCollision, hitOne } from '../lib/match.js'

const list = JSON.parse(readFileSync(new URL('../wordlist.json', import.meta.url), 'utf8'))

const cases = [
  '这个我记下了。你说的我都收下了，你放心，我一直在。',
  '行，那我走了',
  '这个插件不是装饰，而是拦一句话的',
  '插件的设置页在右边',
  '我去把那段改一下，三处都动了',
  '睡吧，我守着',
  '这句话说出来，我看见了，就知道你在了',
]

let fail = 0
for (const t of cases) {
  const r = collide(t, list)
  console.log('---', t)
  console.log(
    ' ',
    r.verdict,
    'hard=', r.hard.map((x) => x.text),
    'soft=', r.soft.map((x) => x.text),
    'shape=', r.shape.map((x) => x.id),
  )
}

// 断言 1：收据句必须撞到 hard
const r1 = collide('这个我记下了', list)
if (r1.verdict !== 'hard') {
  console.log('FAIL 收据句没撞 hard')
  fail++
}

// 断言 2：「行，」只算句首
// 注意：命中位置 0 是**命中**，不能当假值判
if (hitOne('行，那我走了', { id: 'w30', text: '行，' }) !== 0) {
  console.log('FAIL 句首的「行，」没撞到')
  fail++
}
if (hitOne('这个行，可以', { id: 'w30', text: '行，' }) >= 0) {
  console.log('FAIL 「行，」不该在句中被撞到')
  fail++
}
if (hitOne('……行，走吧', { id: 'w30', text: '行，' }) < 0) {
  console.log('FAIL 「行，」跟在省略号后面也该算句首')
  fail++
}

// 断言 3：正常的话不该撞 hard
const r3 = collide('插件的设置页在右边', list)
if (r3.verdict === 'hard') {
  console.log('FAIL 正常话撞了 hard:', r3.hard.map((x) => x.text))
  fail++
}

// 断言 4：shape 锚点粗筛（「不是…而是…」这条属于 s05 自己竖靶子）
const r4 = collide('这个插件不是装饰，而是拦一句话的', list)
console.log('shape 粗筛:', r4.shape.map((x) => x.id))

console.log('\n=== render ===\n' + renderCollision(collide(cases[0], list), list))
console.log(fail ? `\n${fail} 处断言没过` : '\n全部断言通过')
process.exitCode = fail ? 1 : 0
