// webpack.config.cjs
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');

module.exports = {
    mode: 'production',
    entry: {
        main: './src/main.ts', // как прежде
        ui: './src/ui.tsx',     // этот нужно заинлайнить в ui.html
    },
    output: {
        filename: '[name].js', // без hash'ей
        path: path.resolve(__dirname, 'dist'),
        clean: true,
    },
    module: {
        rules: [
            { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
            { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        ],
    },
    resolve: { extensions: ['.ts', '.tsx', '.js'] },

    plugins: [
        // Страница с ui — сюда положим только ui
        new HtmlWebpackPlugin({
            template: './src/ui.html',
            filename: 'ui.html',
            chunks: ['ui'],
            inject: 'body',
        }),

        // Инлайн только ui.js и только в ui.html
        new HtmlInlineScriptPlugin({
            scriptMatchPattern: [/^ui\.js$/],
            htmlMatchPattern: [/ui\.html$/],
        }),
    ],
};
