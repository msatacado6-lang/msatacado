const handler=require('../integration-mode.cjs').withIntegration(require('../cloud-api.cjs'));
module.exports=(req,res)=>{require('../security-headers.cjs').applySecurityHeaders(res);return handler(req,res);};
