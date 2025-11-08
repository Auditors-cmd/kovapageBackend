const nodemailer = require('nodemailer');

// Use the NEW app password
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ieghosa36@gmail.com',
    pass: 'pior xkqg wcbs fhtn' // Your NEW app password WITH spaces
  }
});

console.log('Testing NEW Gmail configuration...');

transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Gmail error:', error.message);
  } else {
    console.log('✅ Gmail configured successfully!');
    
    // Send test email
    const mailOptions = {
      from: '"KovaPage" <ieghosa36@gmail.com>',
      to: 'ieghosa36@gmail.com',
      subject: 'Gmail Test - Success!',
      text: 'Your Gmail is now working with KovaPage!'
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log('❌ Send failed:', error.message);
      } else {
        console.log('✅ Test email sent successfully!');
        console.log('Message ID:', info.messageId);
      }
    });
  }
});