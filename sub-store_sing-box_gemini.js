// 适用于 Sub-Store 脚本操作或动态配置生成
async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore;
  // 读取上方 JSON 模板内容
  const config = JSON.parse($arguments.template || '{}');

  // 转换节点为 sing-box 1.15+ 格式，并自动补全 domain_resolver (1.14+ 域名节点必填)
  const singboxProxies = $.produce(proxies, 'sing-box');
  singboxProxies.forEach(p => {
    if (!p.domain_resolver) {
      p.domain_resolver = 'Local-DNS';
    }
  });

  // 按订阅名称或正则过滤分组节点
  const fqTags = singboxProxies.filter(p => p._subName === 'fq' || /fq/i.test(p.tag)).map(p => p.tag);
  const fqmlTags = singboxProxies.filter(p => p._subName === 'fq ml' || /ml/i.test(p.tag)).map(p => p.tag);
  const cnmlTags = singboxProxies.filter(p => p._subName === 'cn ml' || /cn/i.test(p.tag)).map(p => p.tag);
  const allTags = singboxProxies.map(p => p.tag);

  // 动态注入到对应 selector 出站
  config.outbounds.forEach(outbound => {
    if (outbound.tag === 'fq') {
      outbound.outbounds = fqTags.length ? fqTags : allTags;
    } else if (outbound.tag === 'fq ml') {
      outbound.outbounds = fqmlTags.length ? fqmlTags : allTags;
    } else if (outbound.tag === 'cn ml') {
      outbound.outbounds = cnmlTags.length ? cnmlTags : ['direct'];
    }
  });

  // 将所有实际节点追加到 outbounds 列表末尾
  config.outbounds.push(...singboxProxies);

  return config;
}
