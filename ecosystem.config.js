module.exports = {
    apps : [{
        name: 'MineSkin',
        script: './index.js',
        node_args: '--max_old_space_size=4096 --optimize_for_size --stack_size=4096',
        cwd: '/home/inventivetalent/api.mineskin.org'
    }]
};