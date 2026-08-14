const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const HF_TOKEN = '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';
const HF_API = 'https://api-inference.huggingface.co/models/Qwen/Qwen3.8-27B';

app.post('/api/qwen', async (req, res) => {
    try {
        const { messages, max_tokens, token } = req.body;
        const useToken = token || HF_TOKEN;

        const prompt = messages.map(m => m.role + ': ' + m.content).join('\n');

        const response = await fetch(HF_API, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + useToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    max_new_tokens: max_tokens || 1024,
                    temperature: 0.7,
                    top_p: 0.9,
                    do_sample: true,
                    return_full_text: false
                }
            })
        });

        if (!response.ok) {
            const err = await response.text();
            return res.status(response.status).json({ error: err });
        }

        const data = await response.json();
        if (data.error) {
            return res.status(400).json({ error: data.error });
        }

        let result = '';
        if (Array.isArray(data) && data[0] && data[0].generated_text) {
            result = data[0].generated_text.trim();
        } else if (data.generated_text) {
            result = data.generated_text.trim();
        } else {
            result = JSON.stringify(data);
        }

        res.json({ response: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 Proxy server running on port', PORT);
});
