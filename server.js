// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

// --- सुरक्षित शुरुआत ---
if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error("FATAL ERROR: RAZORPAY_WEBHOOK_SECRET is missing.");
    process.exit(1);
}

const app = express();
app.use(cors());

// ======================================================================================
// ==================== सिर्फ जासूसी करने वाला वेबहुक हैंडलर =======================
// ======================================================================================
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signatureFromRazorpay = req.headers['x-razorpay-signature'];
    
    console.log("--- [जासूस रिपोर्ट] ---");
    console.log("एक नया वेबहुक मिला। जाँच शुरू।");

    try {
        // सर्वर अपना खुद का सिग्नेचर बना रहा है
        const shasum = crypto.createHmac('sha256', webhookSecret);
        shasum.update(req.body);
        const digestGeneratedByServer = shasum.digest('hex');

        console.log(`सर्वर द्वारा बनाया गया सिग्नेचर: ${digestGeneratedByServer}`);
        console.log(`रेजरपे द्वारा भेजा गया सिग्नेचर: ${signatureFromRazorpay}`);

        // अब हम सच्चाई की जाँच करेंगे
        if (digestGeneratedByServer === signatureFromRazorpay) {
            console.log("🎉🎉🎉 SUCCESS! सिग्नेचर मैच हो गया! समस्या हल हो गई! 🎉🎉🎉");
        } else {
            console.log("❌ FAILURE! सिग्नेचर मैच नहीं हुआ। कोड में अभी भी कोई गहरी समस्या है।");
        }
        
        console.log("--- [रिपोर्ट खत्म] ---");

        res.json({ status: 'ok' });

    } catch (error) {
        console.error("❌ वेबहुक को प्रोसेस करते समय कोई बहुत बड़ी एरर आई:", error.message);
        res.status(500).send('Webhook error.');
    }
});


const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 जासूस सर्वर पोर्ट ${PORT} पर लाइव है और सच्चाई का इंतज़ार कर रहा है।`);
});
