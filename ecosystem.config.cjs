module.exports = {
  apps: [
    {
      name: 'goldtrader',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '200M'
    }
  ]
}
