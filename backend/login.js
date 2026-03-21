const noblox = require('noblox.js');

async function testLogin() {
    const cookie = "_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_CAEaAhADIhwKBGR1aWQSFDEyNzY1MzI0ODk3MTY3NTg3NTE4KAM.4lQiMbd_zAUHqdh8qZcizOu5kDLk7qY39Rn2qd86bVfJTP4J2Lq8Hel6nFx4uhbREzYRUcq1zSq-4AFViSat0Kn0mialq0lYSm2I1y_OamjwVzVGqO2bLk10_HfzKGVn93L9tO-B9z8svgjUIOGW9ZuedAnv8CmU8J5jbk2pSU5up-lMV8gozfCyX3gatcSU-ToE-63M6Q0jCe_DBvJu4DbTfbptl33btZ8hGDQnzbiWRteu-mMyPh7j0m9mT0P864lDlapaDJyrWIPmHnbIJSNnHJk9oD7aqSauwmwnVQhzRZBvfFR51ycvSNXWhgh_3WImbcWJ8rtN7h2iYBnbMAvq97ps-Y-v_-8B8TdfcsbZo_Otw6tSgLR0wGOeZHCvbnbLQ6SrDUlPmdJPrCap3beLBLlC_d7BpI8MUJ8cHl7FjliG0ioQBsAIIN3wwAyBfnK0I5GIp1YEM91Dk8r5ghXirwYV4dc--kB2hwr5rM0B_7ZstTiygL-vwuIGlWr_EBW0MaWVbkzZTKwEUYsa7kB9GiSehWx_tkWoprjdiuVZBPTiZo7TcoKb1MDAmn363xTuJ5_xobeiPXNaVW-CKF3_-Ju9NGrr3gwdaj4N6iG9UInNh6GODLzhXg4nJOKwoaJRX5ie7-PzSYBjuTH0OEbAN_IeUZT8NO8cxo58UR5gFubVI9SvLP4GRGu5pEQaLOSR7NQdadXszb5eYDa_DVFUnYY6I3uNWcdj4f3f0kbh3bLks6lK0DzycTzdQwvde7CeyZoba-0s2KiZLPq3QFX2rCG_XNo9XfqMmYNMjqxQgztXAFH_WmQbxLVV-sFVby-PPkakGo4TfGB5y5JGRvOUxK1lUy6SgvX-3RFTJm3VQWN-CrJ_1ZesiPlgTL5WKaGm5zQiTHrj5kRcdhTeLAIX2NylKzLUnypqEN5ih6ZW5JS9NZiD0j5p5Or7WNmQfSU2x0tmdh2DMjUngxj9l0svs2w";
    
    try {
        console.log('Attempting login with cookie...');
        const user = await noblox.setCookie(cookie);
        console.log('✅ Login successful!');
        console.log('User ID:', user.UserID);
        console.log('Username:', user.UserName);
        
        const currentUser = await noblox.getCurrentUser();
        console.log('Current user:', currentUser);
    } catch (error) {
        console.error('❌ Login failed:', error.message);
        console.error('Full error:', error);
    }
}

testLogin();
