# 可选实验服务部署

默认小程序在设备本地处理文件，不连接本服务。以下仅供独立部署实验服务的开发者使用，不是使用兔子阅读器的前置步骤。

这套配置适合一台带公网 IP、已安装 Docker Compose 的 Linux 服务器。它会自动申请 HTTPS 证书，并将临时网页保存在 Docker 持久卷中。

## 前置条件

1. 准备一个独立子域名，例如 `html.example.com`。
2. 将该域名的 A/AAAA 记录指向服务器。
3. 开放公网 80 和 443 端口。
4. 不要在同一个域名部署登录后台、Cookie 身份或其他敏感业务。

## 启动

在仓库 `deploy` 目录执行：

```sh
export HTML_READER_DOMAIN=html.example.com
docker compose up -d --build
curl https://html.example.com/health
```

健康检查应返回 `{"ok":true,"ttlHours":24}`。

## 接入小程序

1. 当前小程序包不包含远端高保真配置（`scripts/check-production-config.js` 会拒绝任何指向远端服务的常量进入包内）；这套服务只作为独立实验部署，小程序侧不接入。
2. 运行 `npm run check:production`。
3. 在微信公众平台“开发管理 → 开发设置 → 服务器域名”中，把该域名加入 `uploadFile` 合法域名。
4. 在“业务域名”中加入同一域名，并按后台提示完成域名归属校验。
5. 关闭开发者工具“不校验合法域名”，重新编译并真机测试。

## 运维边界

- 默认每个来源地址每小时最多上传 30 次，可用 `HTML_READER_UPLOAD_LIMIT` 和 `HTML_READER_UPLOAD_WINDOW_MS` 调整。
- 文件默认 24 小时删除，单个上传最大 20 MB，ZIP 解压最大 60 MB / 2000 个文件。
- 应额外配置磁盘容量告警、容器更新和服务器备份策略。
- 不要记录或外发随机网页访问路径；该路径相当于临时访问凭证。
