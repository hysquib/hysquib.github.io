// 博客系统配置
window.CONFIG = {
    // Worker API 地址（自定义域名）
    WORKER_URL: 'https://adminblog.hysquib.cn',
    
    // 存储模式:
    // - 'github': 使用 GitHub 仓库存储（通过 Worker API）
    // - 'local': 使用本地 localStorage 存储
    STORAGE_MODE: 'github',
    
    // GitHub 配置（当 STORAGE_MODE 为 'github' 时使用）
    GITHUB: {
        owner: 'hysquib',
        repo: 'hysquib.github.io',
        branch: 'main',
        postsPath: 'data/posts.json',
    },
    
    // 网站版本号 - 用于缓存控制
    VERSION: '2.0.4',
};
