# 《崇祯十年》私人书房入口

此仓库仅存放固定访问入口和当前连接地址，不存放小说正文、密码、登录令牌或审阅数据。

小说网站运行在作者自己的服务器，通过 HTTPS 连接，并在登录后开放阅读、修改和批准。局域网直接访问入口已关闭。

首次启用时，由站点所有者在服务器终端运行 `python3 ~/novel-reader/setup_editor.py` 设置密码；以后从固定入口使用该密码登录。

当前连接使用 Cloudflare Quick Tunnel。入口网址不变，连接地址在隧道重启后自动更新。Quick Tunnel 用于测试和开发，没有可用性保证；服务器关机时书房无法打开。如需长期稳定服务，应配置有固定主机名的正式隧道。

来源说明：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。
