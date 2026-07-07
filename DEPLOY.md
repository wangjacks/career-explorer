# 部署文档：服务器部署 + 域名绑定

## 一、环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Ubuntu 22.04 / Debian 12 / CentOS 8+ |
| Node.js | 18.x 或 20.x |
| npm | 9.x 或 10.x |
| 域名 | 已备案的域名（国内服务器需 ICP 备案） |
| 端口 | 3000（应用）、80/443（Nginx 反向代理） |

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

### 2. 安装 Nginx

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 3. 创建部署目录

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

# 配置环境变量
cat > .env.local << 'EOF'
ADMIN_PASSWORD=你的后台密码
EOF

# 构建生产版本
npm run build
```

构建成功后会生成 `.next/` 目录。

## 五、用 PM2 进行进程管理

### 1. 安装 PM2

```bash
sudo npm install -g pm2
```

### 2. 启动应用

```bash
cd /var/www/career-app

# 启动（注意路径要指向 npm 脚本）
pm2 start npm --name "career-app" -- start

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

## 八、防火墙配置

```bash
# UFW（Ubuntu）
sudo ufw allow 'Nginx Full'
sudo ufw enable

# 或直接开放端口
sudo ufw allow 80
sudo ufw allow 443
```

## 九、域名绑定

在域名注册商的 DNS 管理页面添加：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | @ | 服务器公网 IP |
| A | www | 服务器公网 IP |

DNS 生效后访问 `https://your-domain.com` 即可。

## 十、部署后验证

```bash
# 检查应用是否运行
pm2 status

# 检查 Nginx 状态
sudo systemctl status nginx

# 测试接口
curl http://localhost:3000/api/admin/stats -H "Authorization: Bearer 你的密码"

# 检查端口监听
sudo netstat -tlnp | grep -E ':(80|443|3000)'
```

## 十一、常见问题

### 502 Bad Gateway

```bash
# 应用未启动，检查 PM2
pm2 logs career-app

# 确认端口 3000 被监听
sudo netstat -tlnp | grep 3000
```

### 上传文件 413 错误

在 Nginx 配置中调大 `client_max_body_size`，默认 1M。

### 数据库权限问题

确保应用对 `data.db` 所在目录有读写权限：

```bash
sudo chown -R $USER:$USER /var/www/career-app
chmod 644 /var/www/career-app/data.db
```

### 更新部署

```bash
cd /var/www/career-app
git pull
npm install
npm run build
pm2 restart career-app
```

## 十二、目录结构总览

```
/var/www/career-app/
├── .env.local          # 环境变量（密码等）
├── .next/              # 构建产物
├── data.db             # SQLite 数据库（自动创建）
├── public/uploads/     # 用户上传的头像
├── package.json
└── ...
```
