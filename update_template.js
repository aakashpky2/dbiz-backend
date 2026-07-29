const { supabase } = require('./lib/supabase');

const newContent = `
<div style="font-family: Arial, sans-serif; position: relative; max-width: 850px; margin: auto; padding: 35px; color: #111827; background: #ffffff; border: 1px solid #e5e7eb;">

  <!-- Watermark -->
  <div style="position: absolute; top: 42%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 58px; font-weight: 800; color: rgba(37,99,235,0.06); z-index: 0; white-space: nowrap;">
    {{company_name}}
  </div>

  <div style="position: relative; z-index: 1;">

    <!-- Header -->
    <table style="width: 100%; border-bottom: 4px solid #1d4ed8; padding-bottom: 15px;">
      <tr>
        <td style="width: 70%;">
          <img src="{{company_logo}}" alt="Logo" style="max-height: 70px; margin-bottom: 8px;" />
          <h2 style="margin: 0; font-size: 22px; color: #111827;">{{company_name}}</h2>
          <p style="margin: 4px 0; font-size: 13px;">{{company_address}}</p>
          <p style="margin: 4px 0; font-size: 13px;">Email: {{company_email}} | Phone: {{company_phone}}</p>
          <p style="margin: 4px 0; font-size: 13px;">GSTIN: {{company_gstin}}</p>
        </td>
        <td style="text-align: right; vertical-align: top;">
          <h1 style="margin: 0; font-size: 32px; color: #1d4ed8; letter-spacing: 2px;">PROPOSAL</h1>
          <p style="margin: 10px 0 0; font-size: 13px;"><strong>Proposal No:</strong> {{proposal_no}}</p>
          <p style="margin: 5px 0; font-size: 13px;"><strong>Date:</strong> {{proposal_date}}</p>
          <p style="margin: 5px 0; font-size: 13px;"><strong>Branch:</strong> {{branch_name}}</p>
        </td>
      </tr>
    </table>

    <!-- Client Details -->
    <div style="margin-top: 25px; padding: 16px; background: #f8fafc; border-left: 5px solid #1d4ed8; border-radius: 8px;">
      <h3 style="margin: 0 0 10px; color: #111827;">Proposal To</h3>
      <p style="margin: 4px 0; font-size: 14px;"><strong>{{client_name}}</strong></p>
      <p style="margin: 4px 0; font-size: 13px;">{{client_address}}</p>
      <p style="margin: 4px 0; font-size: 13px;">Email: {{client_email}}</p>
      <p style="margin: 4px 0; font-size: 13px;">Phone: {{client_phone}}</p>
      <p style="margin: 4px 0; font-size: 13px;">GSTIN: {{client_gstin}}</p>
    </div>

    <!-- Intro -->
    <p style="margin-top: 24px; font-size: 14px; line-height: 1.7;">
      Dear Sir/Madam,<br><br>
      We are pleased to submit our professional proposal for the services listed below. This proposal includes our professional fees, applicable government fees, taxes, and other relevant details.
    </p>

    <!-- Scope -->
    <h3 style="margin-top: 25px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; color: #111827;">Scope of Work</h3>
    <div style="margin-top: 10px;">
      {{{work_table}}}
    </div>

    <!-- Summary -->
    <div style="margin-top: 30px; text-align: right;">
      <table style="width: 390px; margin-left: auto; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 11px; border: 1px solid #d1d5db; background: #f9fafb; text-align: left;">Professional Fees</td>
          <td style="padding: 11px; border: 1px solid #d1d5db; text-align: right;">₹{{professional_fee}}</td>
        </tr>
        <tr>
          <td style="padding: 11px; border: 1px solid #d1d5db; background: #f9fafb; text-align: left;">Government Fees</td>
          <td style="padding: 11px; border: 1px solid #d1d5db; text-align: right;">₹{{government_fee}}</td>
        </tr>
        <tr>
          <td style="padding: 11px; border: 1px solid #d1d5db; background: #f9fafb; text-align: left;">GST ({{gst_percentage}}%)</td>
          <td style="padding: 11px; border: 1px solid #d1d5db; text-align: right;">₹{{gst_amount}}</td>
        </tr>
        <tr>
          <td style="padding: 13px; background: #1d4ed8; color: #ffffff; text-align: left;"><strong>Grand Total</strong></td>
          <td style="padding: 13px; background: #1d4ed8; color: #ffffff; text-align: right;"><strong>₹{{total_amount}}</strong></td>
        </tr>
      </table>
    </div>

    <!-- Terms -->
    <div style="margin-top: 35px;">
      <h3 style="margin-bottom: 10px;">Terms & Conditions</h3>
      <ol style="font-size: 13px; line-height: 1.7; padding-left: 20px;">
        <li>This proposal is valid until {{valid_until}}.</li>
        <li>Government fees are subject to change based on statutory updates.</li>
        <li>Professional fees are payable as per agreed payment terms.</li>
        <li>Work will commence after confirmation and receipt of required documents.</li>
        <li>Any additional work outside the above scope will be charged separately.</li>
      </ol>
    </div>

    <!-- Signature & Stamp -->
    <table style="width: 100%; margin-top: 45px;">
      <tr>
        <td style="width: 55%; vertical-align: bottom;">
          <p style="font-size: 13px;">Thank you for choosing <strong>{{company_name}}</strong>.</p>
        </td>
        <td style="width: 45%; text-align: center;">
          <div style="display: inline-block; width: 170px; height: 90px; border: 2px dashed rgba(29,78,216,0.55); border-radius: 50%; color: rgba(29,78,216,0.75); font-weight: bold; font-size: 13px; text-align: center; padding-top: 35px; transform: rotate(-8deg); margin-bottom: 8px;">
            COMPANY<br>SEAL
          </div>
          <p style="margin: 8px 0 45px;">For {{company_name}}</p>
          <p style="border-top: 1px solid #111827; padding-top: 7px; display: inline-block; min-width: 190px;">
            Authorised Signatory
          </p>
        </td>
      </tr>
    </table>

    <!-- Footer -->
    <div style="margin-top: 25px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #6b7280;">
      This is a system-generated proposal issued by {{company_name}}.
    </div>

  </div>
</div>
`;

async function updateTemplate() {
    console.log('Updating template...');
    const { data, error } = await supabase
        .from('templates')
        .update({ content: newContent })
        .eq('name', 'Standard Professional Proposal')
        .select();
        
    if (error) {
        console.error('Error updating template:', error);
    } else {
        console.log('Successfully updated template!', data[0]?.id);
    }
}

updateTemplate();
