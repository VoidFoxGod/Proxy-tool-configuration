/**
 * 独立动态生成 sing-box 1.15.x+ 配置脚本
 * 兼容 Sub-Store (脚本操作) 及自定义 Node.js 转换
 */
async function operator(proxies = [], targetPlatform, context) {
  const $ = typeof $substore !== 'undefined' ? $substore : null;
  
  // 1. 将订阅节点转换为 sing-box 格式并补充 1.14+ 必需的 domain_resolver
  const singboxProxies = $ ? $.produce(proxies, 'sing-box') : proxies;
  singboxProxies.forEach(p => {
    if (p.server && !/^\d+\.\d+\.\d+\.\d+$/.test(p.server) && !p.server.includes(':') && !p.domain_resolver) {
      p.domain_resolver = 'Local-DNS';
    }
  });

  // 2. 动态按订阅名或节点名匹配分组（若为空则自动回退到 ['direct'] 防止报错）
  const allTags = singboxProxies.map(p => p.tag);
  const getTags = (subName, regex, fallbackToAll = true) => {
    const matched = singboxProxies
      .filter(p => p._subName === subName || regex.test(p.tag))
      .map(p => p.tag);
    if (matched.length > 0) return matched;
    if (fallbackToAll && allTags.length > 0) return allTags;
    return ['direct'];
  };

  const fqTags = getTags('fq', /fq/i, true);
  const fqmlTags = getTags('fq ml', /ml/i, true);
  const cnmlTags = getTags('cn ml', /cn/i, false);

  // 3. 构建完整 sing-box 1.15.x+ 配置
  return {
    log: { disabled: false, level: "info", timestamp: false },
    experimental: {
      clash_api: {
        external_controller: "127.0.0.1:20123",
        secret: "0dee5956a74501df87a5cb350527956573b1ee199767b28e931e145c768de6d5",
        default_mode: "rule",
        access_control_allow_origin: ["*"],
        access_control_allow_private_network: false
      },
      cache_file: {
        enabled: true,
        path: "cache.db",
        cache_id: "singbox_cache",
        store_fakeip: true,
        store_dns: true
      }
    },
    http_clients: [
      { tag: "direct-client", detour: "direct" }
    ],
    dns: {
      disable_cache: true,
      disable_expire: true,
      final: "Remote-DNS",
      servers: [
        { tag: "Local-DNS", type: "https", server: "dns.alidns.com", server_port: 443, path: "/dns-query", domain_resolver: "Local-DNS-Resolver" },
        { tag: "Local-DNS-Resolver", type: "udp", server: "223.5.5.5", server_port: 53 },
        { tag: "Remote-DNS", type: "https", server: "dns.google", server_port: 443, path: "/dns-query", detour: "🚀 节点选择", domain_resolver: "Remote-DNS-Resolver" },
        { tag: "Remote-DNS-Resolver", type: "udp", server: "8.8.8.8", server_port: 53, detour: "🚀 节点选择" },
        { tag: "OneDNS", type: "https", server: "doh.onedns.net", server_port: 443, path: "/dns-query", detour: "ChinaRouter", domain_resolver: "OneDNS-Resolver" },
        { tag: "OneDNS-Resolver", type: "udp", server: "117.50.11.11", server_port: 53, detour: "ChinaRouter" },
        { tag: "Quad9-DNS", type: "https", server: "dns11.quad9.net", server_port: 443, path: "/dns-query", detour: "🚀 节点选择", domain_resolver: "Quad9-DNS-Resolver" },
        { tag: "Quad9-DNS-Resolver", type: "udp", server: "9.9.9.11", server_port: 53, detour: "🚀 节点选择" }
      ],
      rules: [
        { clash_mode: "direct", action: "route", server: "Local-DNS" },
        { clash_mode: "global", action: "route", server: "Remote-DNS" },
        { rule_set: "cn", action: "route", server: "Local-DNS" },
        { rule_set: "proxy", action: "route", server: "Remote-DNS" }
      ]
    },
    inbounds: [
      { type: "http", tag: "http-in", listen: "::", listen_port: 80 },
      { type: "socks", tag: "socks-in", listen: "::", listen_port: 1080 },
      { type: "mixed", tag: "mixed-in", listen: "::", listen_port: 20122 },
      {
        type: "tun",
        tag: "tun-in",
        address: ["172.18.0.1/30", "fdfe:dcba:9876::1/126"],
        auto_route: true,
        strict_route: true,
        endpoint_independent_nat: true
      }
    ],
    outbounds: [
      { type: "direct", tag: "direct" },
      { type: "selector", tag: "🚀 节点选择", outbounds: ["direct", "fq", "fq ml"], interrupt_exist_connections: true },
      { type: "selector", tag: "fq", outbounds: fqTags, interrupt_exist_connections: true },
      { type: "selector", tag: "fq ml", outbounds: fqmlTags, interrupt_exist_connections: true },
      { type: "selector", tag: "🎯 全球直连", outbounds: ["direct"], interrupt_exist_connections: true },
      { type: "selector", tag: "🐟 漏网之鱼", outbounds: ["🚀 节点选择", "🎯 全球直连"], interrupt_exist_connections: true },
      { type: "selector", tag: "GLOBAL", outbounds: ["🚀 节点选择", "🎯 全球直连", "🐟 漏网之鱼"], interrupt_exist_connections: true },
      { type: "selector", tag: "ChinaRouter", outbounds: ["direct", "cn ml"], interrupt_exist_connections: true },
      { type: "selector", tag: "cn ml", outbounds: cnmlTags, interrupt_exist_connections: true },
      ...singboxProxies
    ],
    route: {
      auto_detect_interface: true,
      find_process: true,
      final: "🐟 漏网之鱼",
      default_http_client: "direct-client",
      default_domain_resolver: { server: "Local-DNS" },
      rule_set: [
        { type: "remote", tag: "private", format: "binary", url: "https://gcore.jsdelivr.net/gh/DustinWin/ruleset_geodata@sing-box-ruleset/private.srs", http_client: "direct-client" },
        { type: "remote", tag: "private_ip", format: "binary", url: "https://gcore.jsdelivr.net/gh/DustinWin/ruleset_geodata@sing-box-ruleset/privateip.srs", http_client: "direct-client" },
        { type: "remote", tag: "httpdns", format: "binary", url: "https://gcore.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/singbox/version5/httpdns.srs", http_client: "direct-client" },
        { type: "remote", tag: "pcdn", format: "binary", url: "https://gcore.jsdelivr.net/gh/VoidFoxGod/pcdn-rules@main/pcdn.srs", http_client: "direct-client" },
        { type: "remote", tag: "adrules", format: "binary", url: "https://gcore.jsdelivr.net/gh/DustinWin/ruleset_geodata@sing-box-ruleset/ads.srs", http_client: "direct-client" },
        { type: "remote", tag: "proxy", format: "binary", url: "https://gcore.jsdelivr.net/gh/DustinWin/ruleset_geodata@sing-box-ruleset/proxy.srs", http_client: "direct-client" },
        { type: "remote", tag: "cn", format: "binary", url: "https://gcore.jsdelivr.net/gh/DustinWin/ruleset_geodata@sing-box-ruleset/cn.srs", http_client: "direct-client" },
        { type: "remote", tag: "cn_ip", format: "binary", url: "https://gcore.jsdelivr.net/gh/DustinWin/ruleset_geodata@sing-box-ruleset/cnip.srs", http_client: "direct-client" }
      ],
      rules: [
        { inbound: "tun-in", action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        { clash_mode: "direct", action: "route", outbound: "🎯 全球直连" },
        { clash_mode: "global", action: "route", outbound: "GLOBAL" },
        { network: "icmp", action: "route", outbound: "🎯 全球直连" },
        { rule_set: ["private", "private_ip"], action: "route", outbound: "🎯 全球直连" },
        { protocol: ["quic", "stun"], action: "reject" },
        { rule_set: ["httpdns", "pcdn", "adrules"], action: "reject" },
        { rule_set: "proxy", action: "route", outbound: "🚀 节点选择" },
        { rule_set: ["cn", "cn_ip"], action: "route", outbound: "ChinaRouter" }
      ]
    }
  };
}
