const { tavily } = require('@tavily/core');
const client = tavily({ apiKey: "tvly-dev-************************\*************************" });
client.search("linkedIn of Blinx Solutions UK \n\n\n", {
searchDepth: "advanced"
})
.then(console.log);
