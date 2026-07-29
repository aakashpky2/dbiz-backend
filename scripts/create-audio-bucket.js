const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function createBucket() {
  const { data, error } = await supabase.storage.createBucket('workflow-audio', {
    public: true,
    fileSizeLimit: 20971520, // 20MB
    allowedMimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a']
  });

  if (error) {
    if (error.message.includes('already exists')) {
      console.log('Bucket already exists.');
    } else {
      console.error('Error creating bucket:', error);
    }
  } else {
    console.log('Bucket created successfully:', data);
  }
}

createBucket();
