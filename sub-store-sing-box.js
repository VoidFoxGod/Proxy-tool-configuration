/**
 * Sub-Store 文件动态生成 · sing-box 配置示例脚本
 *
 * 原理:把「模板(本地文本 $content 或 远程文件 $files[0])」和「订阅节点」合并成完整的
 * sing-box 配置,写回 $content,即该文件对外输出的内容。
 *
 * 在 Sub-Store「文件」页面新建文件:
 *   - 远程文件: 填模板链接(如本仓库 sing-box-template.min.json 的 raw 链接)
 *     或 本地文本: 直接粘贴模板内容(二选一)
 *   - 脚本操作: 填本脚本的 URL,并在 # 后带参数。两种模式二选一:
 *
 *   ① src 多源模式(等价 mihomo 的 use: provider-xxx,推荐):
 *     https://your-host/sub-store-sing-box.js#src=fq:机场A,fq ml:免流订阅,cn ml:国内免流订阅
 *     把「订阅」整包插入模板中 tag 精确相等的分组(组名含空格时,手写 URL 用 %20,
 *     前端可视化参数编辑可直接输入空格)。
 *
 *   ② name 单源模式:
 *     https://your-host/sub-store-sing-box.js#name=订阅名
 *     单个订阅(或组合订阅)的节点按「插入规则」匹配分组。
 *
 * 通用参数(写在脚本链接 # 之后,用 & 连接):
 *   type                    可选。1 / col / 组合 → 组合订阅;不填 → 单订阅(对 src 每一项同样生效)
 *   outbound                可选(仅 name 模式)。自定义「哪些节点插入哪些 outbound」,
 *                           多段规则用 🕳 分隔,每段: outbound正则[ℹ️][🏷节点正则[ℹ️]]
 *                           ℹ️ = 忽略大小写;不给 🏷 表示插入全部节点。
 *   includeUnsupportedProxy 可选。=true 时包含 SSR / Snell 等暂不支持的协议
 */

log(`🚀 sing-box 模板脚本开始`)

let { name, type, src, outbound, includeUnsupportedProxy } = $arguments || {}
log(`传入参数 name: ${name}, type: ${type}, src: ${src}, outbound: ${outbound}`)

const srcMode = Boolean(src && String(src).trim())
if (!name && !srcMode) {
  throw new Error('缺少 name 或 src 参数: 请在脚本链接 # 后传入 name=订阅名,或 src=组名:订阅名,组名:订阅名')
}

const targetType = /^1$|col|组合/i.test(type ?? '') ? 'collection' : 'subscription'
const produceOpts = {
  'include-unsupported-proxy': includeUnsupportedProxy,
}

// ① 读取模板: 优先「本地文本」($content), 其次「远程文件」($files[0])
const parser = ProxyUtils?.JSON5 || JSON
let config
try {
  config = parser.parse($content ?? $files?.[0])
} catch (e) {
  throw new Error(`模板不是合法的 JSON5/JSON: ${e.message ?? e}`)
}
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []

// ② 获取节点并插入分组
const allOutbounds = []
const allEndpoints = []

if (srcMode) {
  if (outbound) log(`⚠️ src 多源模式下忽略 outbound 参数`)
  const sources = String(src)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':')
      if (i === -1) throw new Error(`src 参数格式错误: ${s}(应为 组名:订阅名)`)
      return { group: s.slice(0, i).trim(), name: s.slice(i + 1).trim() }
    })
  for (const item of sources) {
    log(`获取订阅 ${item.name} → 插入分组 ${item.group}`)
    const data = JSON.parse(
      await produceArtifact({ name: item.name, type: targetType, platform: 'sing-box', produceOpts })
    )
    const nodes = [...(data.outbounds ?? []), ...(data.endpoints ?? [])]
    const group = config.outbounds.find((o) => o.tag === item.group)
    if (!group) {
      log(`⚠️ 模板中不存在 tag 为 "${item.group}" 的分组, 其节点仅追加到出站列表`)
    } else {
      if (!Array.isArray(group.outbounds)) group.outbounds = []
      group.outbounds.push(...nodes.map((p) => p.tag))
    }
    allOutbounds.push(...(data.outbounds ?? []))
    allEndpoints.push(...(data.endpoints ?? []))
  }
} else {
  const data = JSON.parse(
    await produceArtifact({ name, type: targetType, platform: 'sing-box', produceOpts })
  )
  allOutbounds.push(...(data.outbounds ?? []))
  allEndpoints.push(...(data.endpoints ?? []))
  const proxies = [...allOutbounds, ...allEndpoints]
  log(`获取到 ${allOutbounds.length} 个节点, ${allEndpoints.length} 个端点`)

  // ③ 解析插入规则(未传 outbound 参数时使用内置默认规则)
  //    默认: fq ← 非免流节点; fq ml ← 免流节点(非国内运营商); cn ml ← 国内运营商免流节点
  const DEFAULT_RULES =
    '🕳ℹ️^fq$🏷ℹ️^(?!.*(?:免流|mianliu)).*$' +
    '🕳ℹ️^fq ml$🏷ℹ️^(?!.*(?:国内|大陆|移动|联通|电信|unicom|mobile|telecom))(?=.*(?:免流|mianliu))' +
    '🕳ℹ️^cn ml$🏷ℹ️^(?=.*(?:免流|mianliu)).*(?:国内|大陆|移动|联通|电信|unicom|mobile|telecom)'

  const rules = String(outbound || DEFAULT_RULES)
    .split('🕳')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [outboundPattern, tagPattern = '.*'] = s.split('🏷')
      log(`匹配 🕳 ${toRegExp(outboundPattern)} 的分组 ← 插入 🏷 ${toRegExp(tagPattern)} 的节点`)
      return { outbound: toRegExp(outboundPattern), filter: toRegExp(tagPattern) }
    })

  // ④ 按规则把节点 tag 追加进模板对应分组
  for (const o of config.outbounds) {
    for (const r of rules) {
      if (r.outbound.test(o.tag)) {
        if (!Array.isArray(o.outbounds)) o.outbounds = []
        const tags = proxies.filter((p) => r.filter.test(p.tag)).map((p) => p.tag)
        log(`🕳 ${o.tag} ← 插入 ${tags.length} 个节点`)
        o.outbounds.push(...tags)
      }
    }
  }
}

// ⑤ 空分组兜底: selector/urltest 的 outbounds 为空时插入 COMPATIBLE(direct), 防止 sing-box 报错
const compatible = { tag: 'COMPATIBLE', type: 'direct' }
let compatibleAdded = false
for (const o of config.outbounds) {
  if (
    (o.type === 'selector' || o.type === 'urltest') &&
    Array.isArray(o.outbounds) &&
    o.outbounds.length === 0
  ) {
    if (!compatibleAdded) {
      config.outbounds.push(compatible)
      compatibleAdded = true
    }
    o.outbounds.push(compatible.tag)
    log(`⚠️ ${o.tag} 无匹配节点, 已插入 COMPATIBLE`)
  }
}

// ⑥ 追加节点本体, 写回 $content 作为文件输出
config.outbounds.push(...allOutbounds)
config.endpoints.push(...allEndpoints)

$content = JSON.stringify(config, null, 2)
log(`🔚 完成, 输出 ${config.outbounds.length} 个 outbound, ${config.endpoints.length} 个 endpoint`)

function toRegExp(pattern) {
  const insensitive = pattern.includes('ℹ️')
  return new RegExp(pattern.replace(/ℹ️/g, ''), insensitive ? 'i' : undefined)
}

function log(v) {
  console.log(`[📦 sing-box 示例脚本] ${v}`)
}
