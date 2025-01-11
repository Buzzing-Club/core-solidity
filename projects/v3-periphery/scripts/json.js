const fs = require('fs');

// 读取JSON文件
fs.readFile('../v3-periphery/artifacts/build-info/ec9e996a376eef837d2ed9d6cca2aeda.json', 'utf8', (err, data) => {
    if (err) {
        console.error('读取文件失败:', err);
        return;
    }

    try {
        // 将读取的内容解析为JSON对象
        const jsonObj = JSON.parse(data);

        // 获取 input 字段中的数据
        const inputData = jsonObj.input;

        if (!inputData) {
            console.error('未找到input字段');
            return;
        }

        // 将 input 数据写入到一个新的 JSON 文件
        fs.writeFile('output.json', JSON.stringify(inputData, null, 4), (err) => {
            if (err) {
                console.error('写入文件失败:', err);
                return;
            }
            console.log('input数据已保存到output.json');
        });
    } catch (err) {
        console.error('解析JSON失败:', err);
    }
});