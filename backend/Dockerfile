# 使用体积较小的 Node.js 官方镜像。Node.js 22 满足 package.json 的运行要求。
FROM node:22-alpine

# 云托管容器内的应用目录。
WORKDIR /app

# 先复制依赖清单，以便 Docker 在源码变化时复用依赖安装缓存。
COPY package*.json ./

# 仅安装生产依赖；package-lock.json 存在时使用 npm ci 保证构建可复现。
RUN npm ci --omit=dev

# 再复制后端源码和其他运行所需文件。
COPY src ./src

# 微信云托管服务使用 80 端口。代码仍会优先读取平台注入的 PORT。
ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80

# 使用镜像内置的低权限 node 用户运行服务，降低容器安全风险。
USER node

CMD ["npm", "start"]
