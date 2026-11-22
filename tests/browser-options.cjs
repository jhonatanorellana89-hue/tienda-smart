const fs=require('fs');
const executable=process.env.CHROMIUM_PATH||'/usr/bin/chromium';
module.exports=fs.existsSync(executable)?{executablePath:executable}:{};
