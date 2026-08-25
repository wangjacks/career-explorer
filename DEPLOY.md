# 部署文档：服务器部署 + 域名绑定

## 一、环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Ubuntu 22.04 / Debian 12 / CentOS 8+（也支持 Debian 10+ 等旧系统） |
| Node.js | 18.x 或 20.x |
| MySQL | 5.7+ 或 MariaDB 10.3+ |
| 域名 | 已备案的域名（国内服务器需 ICP 备案） |
| 端口 | 3000（应用）、80/443（Nginx 反向代理） |

> **注意**：项目仅支持 MySQL，不支持 SQLite。服务器无需安装 Python 或 C++ 编译工具。

## 二、服务器准备

### 1. 安装 Node.js

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node -v   # v20.x.x
npm -v    # 10.x.x
```

### 2. 安装 MySQL

```bash
# Ubuntu / Debian
sudo apt-get install -y mysql-server

# 启动并设置开机自启
sudo systemctl enable mysql
sudo systemctl start mysql

# 创建数据库（应用会自动创建表结构）
mysql -u root -e "CREATE DATABASE career_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 3. 安装 Nginx

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 4. 创建部署目录

```bash
sudo mkdir -p /var/www/career-app
sudo chown $USER:$USER /var/www/career-app
```

## 三、上传项目代码

### 方式一：Git 克隆

```bash
cd /var/www/career-app
git clone <你的仓库地址> .
```

### 方式二：SCP 上传

```bash
# 在本地执行
scp -r ./career-miniapp-webver-demo/* user@your-server:/var/www/career-app/
```

## 四、安装依赖并构建

```bash
cd /var/www/career-app

# 安装依赖
npm install

# 配置环境变量（JWT 签名密钥；FONT_CDN_PREFIX 为可选的 Google Fonts 镜像前缀）
cat > .env.local << 'EOF'
JWT_SECRET=一个随机字符串作为JWT签名密钥
# 可选：Google Fonts 镜像前缀（官方域名访问不畅的环境配置，构建前生效）
#FONT_CDN_PREFIX=https://fonts.loli.net
EOF

# 构建生产版本
npm run build
```

构建成功后会生成 `.next/` 目录。管理员密码无需在此步配置，将在首次安装引导中设置（见「八、首次安装引导」）。

### 可选：对象存储凭据（S3 兼容，#111）

系统默认将学生头像 / 评价词云存入应用服务器本地 `uploads/` 目录，无需任何配置。若需接入云对象存储（腾讯云 COS / 阿里云 OSS / MinIO / AWS S3 等任意 S3 兼容服务），在管理面板「系统设置 → 存储管理」新增后端后，按返回的后端 ID 在 `.env.local` 中配置凭据并重启服务：

```bash
# 后端 ID 以存储管理页创建后返回为准（示例为 #2）；凭据不入库，只走环境变量
cat >> .env.local << 'EOF'
S3_2_ACCESS_KEY=你的AccessKeyId或SecretId
S3_2_SECRET_KEY=你的AccessKeySecret或SecretKey
EOF

pm2 restart career-app
```

常见端点配置参考（在存储管理页填写）：

| 提供商 | 公网端点（示例） | 内网端点（同云部署时可选） | region 示例 |
|---|---|---|---|
| 腾讯云 COS | `https://cos.ap-shanghai.myqcloud.com` | `https://cos-internal.ap-shanghai.myqcloud.com` | `ap-shanghai` |
| 阿里云 OSS | `https://oss-cn-hangzhou.aliyuncs.com` | `https://oss-cn-hangzhou-internal.aliyuncs.com` | `oss-cn-hangzhou` |
| MinIO（自建） | `http://你的服务器:9000` | 同左 | `us-east-1`（任意） |
| AWS S3 | 不填自定义端点（标准区域即可） | — | `ap-northeast-1` |

要求与行为说明：

- 存储桶须预先创建且设为**私有读写**；应用通过服务端签发 30 分钟限时签名 URL 提供访问，不存在永久公开链接，且签名前按角色权限校验（学生仅本人、教师仅管辖班级）
- 应用服务器与存储同云时配置内网端点，上传/迁移/导出读图走内网节省公网流量；签名 URL 始终基于公网端点签发，浏览器可达
- 可配置根目录前缀（如 `career/2026`），便于多应用共用桶或按学年归档；对象实际路径 = `{桶}/{前缀}/{文件key}`
- 切换默认后端只影响新上传，存量文件不受影响；「迁移本地文件」可把存量文件批量迁入云后端（幂等，可重复执行）
- 备份文件包含存储后端配置（不含凭据），恢复后需在新环境重新配置凭据环境变量
- 端点支持两种风格，系统自动识别：虚拟主机风格（桶名在子域名，如 `https://{桶名}.cos.ap-guangzhou.myqcloud.com`）与服务级/路径风格（如 `https://cos.ap-guangzhou.myqcloud.com`、MinIO `http://host:9000`）；无需手动指定路径风格选项

## 五、用 PM2 进行进程管理

### 1. 安装 PM2

```bash
sudo npm install -g pm2
```

### 2. 启动应用

```bash
cd /var/www/career-app

# 启动
pm2 start npm --name "career-app" -- start
# 如需指定端口：
# PORT=3621 pm2 start npm --name "career-app" -- start

# 查看状态
pm2 status

# 查看日志
pm2 logs career-app
```

### 3. 设置开机自启

```bash
pm2 startup
# 按照输出的提示执行最后一行命令

pm2 save
```

### 4. 常用 PM2 命令

```bash
pm2 restart career-app    # 重启
pm2 stop career-app       # 停止
pm2 delete career-app     # 删除
pm2 monit                 # 实时监控
```

## 六、配置 Nginx 反向代理

### 1. 创建站点配置

```bash
sudo nano /etc/nginx/sites-available/career-app
```

写入以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # 上传文件大小限制
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 首页 HTML 不缓存（避免旧 JS chunk 引用 404）
        # Next.js 已通过 headers() 配置，此处为 Nginx 层加固
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }
}
```

### 2. 启用站点

```bash
sudo ln -s /etc/nginx/sites-available/career-app /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # 检查配置语法
sudo systemctl reload nginx
```

## 七、配置 HTTPS（Let's Encrypt）

### 1. 安装 Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 2. 申请证书

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

按提示输入邮箱，同意服务条款即可。Certbot 会自动修改 Nginx 配置并重载。

### 3. 自动续期

```bash
sudo certbot renew --dry-run
```

Let's Encrypt 证书有效期 90 天，Certbot 会自动通过 cron 续期。

## 八、首次安装引导

### 1. 访问网站

打开浏览器访问 `http://your-domain.com`（或 `https://your-domain.com` 如果已配置 SSL）。

### 2. 完成安装引导

系统会自动跳转到安装引导页面：

1. **选择数据库**：选择 MySQL 或 SQLite
2. **数据库配置**：填写连接信息（MySQL 示例）
   - 主机：`127.0.0.1`（如果 MySQL 在同一台服务器）
   - 端口：`3306`
   - 用户名：`root`（或其他有权限的用户）
   - 密码：MySQL root 密码
   - 数据库名：`career_app`（需提前创建）
3. **测试连接**：点击「测试连接」确认数据库可连接，然后点击「下一步」
4. **管理员密码**：设置管理员密码（至少 8 位），管理员编号固定为 `10001`，请牢记密码
5. **安装**：点击「安装」，系统自动创建表结构和管理员账户
6. **完成**：自动跳转到管理后台，使用编号 `10001` + 刚设置的密码登录

### 3. 管理员密码说明

管理员密码在安装向导中配置，经 bcrypt 哈希后存储在数据库 `users` 表（编号 `10001`），无需手动生成 hash 或配置环境变量。

> **修改/忘记密码**：管理面板改密功能上线前，需直接更新数据库 `users` 表的 `password_hash`（见「常见问题」章节的「忘记管理员密码」）。

## 九、防火墙配置

```bash
# UFW（Ubuntu）
sudo ufw allow 'Nginx Full'
sudo ufw enable

# 或直接开放端口
sudo ufw allow 80
sudo ufw allow 443
```

## 十、域名绑定

在域名注册商的 DNS 管理页面添加：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | @ | 服务器公网 IP |
| A | www | 服务器公网 IP |

DNS 生效后访问 `https://your-domain.com` 即可。

## 十一、部署后验证

```bash
# 检查应用是否运行
pm2 status

# 检查 Nginx 状态
sudo systemctl status nginx

# 测试接口
curl http://localhost:3000/api/setup/status

# 检查端口监听
sudo netstat -tlnp | grep -E ':(80|443|3000)'
```

## 十二、常见问题

### 502 Bad Gateway

```bash
# 应用未启动，检查 PM2
pm2 logs career-app

# 确认端口 3000 被监听
sudo netstat -tlnp | grep 3000
```

### 上传文件 413 错误

在 Nginx 配置中调大 `client_max_body_size`，默认 1M。

### MySQL 连接失败

```bash
# 检查 MySQL 状态
sudo systemctl status mysql

# 测试 MySQL 连接
mysql -u root -p

# 检查数据库是否存在
mysql -u root -e "SHOW DATABASES;"
```

### 忘记管理员密码

管理员密码存储在数据库 `users` 表（bcrypt 哈希），重置方式为直接更新该字段：

```bash
cd /var/www/career-app

# 生成新密码的 bcrypt hash
node -e "require('bcrypt').hash('新密码', 10).then(h => console.log(h))"

# 更新 users 表中管理员（10001）的 password_hash
# SQLite 部署：
sqlite3 data/career.db "UPDATE users SET password_hash='新的hash值' WHERE user_code='10001';"
# MySQL 部署：
mysql -u root -p career_app -e "UPDATE users SET password_hash='新的hash值' WHERE user_code='10001';"
```

### 更新部署

```bash
cd /var/www/career-app
git pull
npm install
npm run build
pm2 restart career-app
```

## 十三、目录结构总览

```
/var/www/career-app/
├── .env.local          # 环境变量（JWT_SECRET 等）
├── .next/              # 构建产物
├── db-config.json      # 数据库配置（安装后自动生成）
├── uploads/            # 用户上传的头像和图片
├── package.json
└── ...
```

## 十四、旧服务器兼容说明（Debian Buster / Ubuntu 18.04 等）

如果服务器系统较旧（如 Debian Buster），apt 源可能已归档。需要先修改 apt 源：

```bash
# Debian Buster
sed -i 's|deb.debian.org|archive.debian.org|g' /etc/apt/sources.list
sed -i 's|security.debian.org|archive.debian.org/debian-security|g' /etc/apt/sources.list
sed -i '/buster-updates/d' /etc/apt/sources.list
apt update
```

项目不依赖 Python 或 C++ 编译工具，只需 Node.js 和 MySQL 即可运行。
