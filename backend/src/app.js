const express = require('express');
const routes = require('./routes');
const notFound = require('./middlewares/not-found');
const errorHandler = require('./middlewares/error-handler');
const { attachIdentity } = require('./middlewares/auth');

const app = express();

// 解析 JSON 和表单请求体，并设置合理的大小上限，防止超大请求占满容器内存。
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// 可信身份边界：每个请求都先解析并挂载可信身份（可能为 null），后续按需 requireUser。
app.use(attachIdentity);

// 注册所有应用路由。404 与错误处理中间件必须放在正常路由之后。
// 注：上传的图片由小程序端经 wx.cloud.uploadFile 直传云存储，后端只接收云存储 fileID，
// 不在此托管本地静态目录，避免容器以非 root 用户启动时创建上传目录导致 EACCES 崩溃，
// 也避免 Pod 重启/多副本时本地图片丢失。
app.use(routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
