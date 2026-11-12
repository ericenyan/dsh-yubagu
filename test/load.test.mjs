// 加载检查：能不能 import 进来、Config 长出来没有
const mod = await import('../lib/index.js')
console.log('name =', mod.name)
console.log('Config =', typeof mod.Config)
console.log('apply =', typeof mod.apply)
try {
  const cfg = mod.Config ? mod.Config({}) : null
  console.log('defaults =', JSON.stringify(cfg))
} catch (e) {
  console.log('Config 调用失败:', e.message)
}
