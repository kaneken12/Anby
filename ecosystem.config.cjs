module.exports = {
  apps: [{
    name: 'anby',
    script: 'src/index.js',
    max_memory_restart: '500M',
    restart_delay: 5000,
    env: { NODE_ENV: 'production' }
  }]
};
