// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config(); // यह लोकल टेस्टिंग के लिए एनवायरनमेंट वेरिएबल्स लोड करता है

// Express ऐप बनाना
const app = express();

// CORS कॉन्फ़िगरेशन (यह सभी वेबसाइटों से आने वाली रिक्वेस्ट को अनुमति देता है, जो Netlify प्रॉक्सी के लिए ज़रूरी है)
app.use(cors());

// Middleware का इस्तेमाल करना
app.use(express.json()); // JSON रिक्वेस्ट बॉडी को समझने के लिए

// Razorpay इंस्टैंस बनाना (API Keys का इस्तेमाल करके)
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- API ENDPOINTS ---

// === यहाँ ज़रूरी बदलाव किया गया है ===
// eMandate (ऑटोपे) बनाने के लिए सही Endpoint (Subscriptions API का उपयोग करके)
app.post('/create-subscription', async (req, res) => {
    try {
        // चरण 1: आपकी Plan ID यहाँ डाल दी गई है
        const plan_id = "plan_RIgEghN6aicmgB"; // <<<--- आपकी Plan ID यहाँ है

        // चरण 2: एक नया सब्सक्रिप्शन बनाना
        const subscriptionOptions = {
            plan_id: plan_id,
            total_count: 48, // सब्सक्रिप्शन कितने बिलिंग साइकिल तक चलेगा (उदाहरण: 48 महीने = 4 साल)
            quantity: 1,
            customer_notify: 1, // रेजरपे ग्राहक को सफल चार्ज और अन्य सूचनाएं भेजेगा
        };

        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        console.log('Subscription created successfully:', subscription.id);

        // फ्रंटएंड को subscription_id और आपकी key_id भेजना
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Error creating Razorpay subscription:', error);
        res.status(500).json({ error: 'Something went wrong while creating the subscription.' });
    }
});
// ======================================


// Webhook सुनने के लिए Endpoint (इसमें कोई बदलाव नहीं किया गया है, यह पहले से ही सही है)
app.post('/webhook', (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    console.log('Webhook received...');
    
    try {
        // Razorpay से आए हुए मैसेज की प्रामाणिकता की जाँच करना
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest === signature) {
            // सिग्नेचर सही है, अब आगे का काम करें
            console.log('Webhook verified successfully.');
            
            const event = req.body.event;
            const payload = req.body.payload;
            
            console.log('EVENT RECEIVED:', event);

            // यहाँ आप अपने चुने हुए Webhook Events के आधार पर काम कर सकते हैं
            // उदाहरण के लिए:
            if (event === 'subscription.activated') {
                console.log('SUBSCRIPTION (eMandate) ACTIVATED! You can now charge this customer.');
                console.log('Subscription ID:', payload.subscription.entity.id);
            }
             if (event === 'payment.captured') {
                console.log('INITIAL PAYMENT CAPTURED!');
                console.log('Payment ID:', payload.payment.entity.id);
                 console.log('Amount:', payload.payment.entity.amount / 100, 'INR');
            }

            // Razorpay को बताना कि हमें मैसेज मिल गया
            res.json({ status: 'ok' });

        } else {
            // सिग्नेचर गलत है
            console.warn('Webhook verification failed.');
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error)
    {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});


// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});
