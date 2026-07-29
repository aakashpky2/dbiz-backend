const { supabase } = require('../lib/supabase');

const newTemplateContent = `
<div style="font-family: Arial, sans-serif; max-width: 900px; margin: auto; padding: 30px; color: #111827; position: relative;">

  <!-- WATERMARK -->
  <div style="
    position:absolute;
    top:45%;
    left:50%;
    transform:translate(-50%, -50%) rotate(-30deg);
    font-size:70px;
    font-weight:bold;
    color:rgba(37,99,235,0.05);
    z-index:0;
    white-space:nowrap;
  ">
    {{company_name}}
  </div>

  <div style="position:relative; z-index:1;">

    <!-- HEADER -->
    <table style="width:100%; border-bottom:3px solid #1d4ed8; padding-bottom:15px;">
      <tr>

        <td style="width:25%; vertical-align:top;">
          {{#if company_logo}}
          <img
            src="{{company_logo}}"
            crossorigin="anonymous"
            style="height:80px; max-width:220px; object-fit:contain;"
          />
          {{/if}}
        </td>

        <td style="width:75%; text-align:right;">
          <h2 style="margin:0; color:#1d4ed8;">
            {{company_name}}
          </h2>

          <p style="margin:3px 0;">
            {{company_address}}
          </p>

          <p style="margin:3px 0;">
            Email: {{company_email}}
          </p>

          <p style="margin:3px 0;">
            Phone: {{company_phone}}
          </p>

          <p style="margin:3px 0;">
            GSTIN: {{company_gstin}}
          </p>

          {{#if company_website}}
          <p style="margin:3px 0;">
            {{company_website}}
          </p>
          {{/if}}
        </td>

      </tr>
    </table>

    <!-- TITLE -->
    <div style="text-align:center; margin-top:20px;">
      <h1 style="
        margin:0;
        color:#1d4ed8;
        letter-spacing:2px;
      ">
        PROPOSAL
      </h1>
    </div>

    <!-- PROPOSAL DETAILS -->
    <table style="
      width:100%;
      margin-top:20px;
      border-collapse:collapse;
      border:2px solid #111;
    ">
      <tr>
        <td style="padding:12px; border:2px solid #111;">
          <strong>Proposal No:</strong> {{proposal_no}}
        </td>

        <td style="padding:12px; border:2px solid #111;">
          <strong>Date:</strong> {{proposal_date}}
        </td>
      </tr>

      <tr>
        <td style="padding:12px; border:2px solid #111;">
          <strong>Branch:</strong> {{branch_name}}
        </td>

        <td style="padding:12px; border:2px solid #111;">
        </td>
      </tr>
    </table>

    <!-- CLIENT -->
    <div style="
      margin-top:25px;
      padding:15px;
      background:#f8fafc;
      border-left:5px solid #1d4ed8;
    ">
      <h3 style="margin-top:0;">
        Proposal To
      </h3>

      <p><strong>{{client_name}}</strong></p>

      <p>{{client_address}}</p>

      <p>Email: {{client_email}}</p>

      <p>Phone: {{client_phone}}</p>

      <p>GSTIN: {{client_gstin}}</p>
    </div>

    <!-- INTRO -->
    <div style="margin-top:20px; line-height:1.8;">
      Dear Sir/Madam,
      <br><br>

      We are pleased to submit our professional proposal for the services listed below.
      This proposal includes our professional fees, applicable government fees,
      taxes, and other relevant details.
    </div>

    <!-- SCOPE -->
    <h3 style="
      margin-top:30px;
      border-bottom:2px solid #e5e7eb;
      padding-bottom:8px;
    ">
      Scope of Work
    </h3>

    <div style="margin-top:10px;">
      {{{work_table}}}
    </div>

    <!-- TOTALS -->
    <div style="margin-top:25px;">

      <table style="
        width:420px;
        margin-left:auto;
        border-collapse:collapse;
      ">

        <tr>
          <td style="
            padding:10px;
            border:1px solid #ccc;
          ">
            Professional Fees
          </td>

          <td style="
            padding:10px;
            border:1px solid #ccc;
            text-align:right;
          ">
            ₹{{professional_fee}}
          </td>
        </tr>

        <tr>
          <td style="
            padding:10px;
            border:1px solid #ccc;
          ">
            Government Fees
          </td>

          <td style="
            padding:10px;
            border:1px solid #ccc;
            text-align:right;
          ">
            ₹{{government_fee}}
          </td>
        </tr>

        <tr>
          <td style="
            padding:10px;
            border:1px solid #ccc;
          ">
            GST ({{gst_percentage}}%)
          </td>

          <td style="
            padding:10px;
            border:1px solid #ccc;
            text-align:right;
          ">
            ₹{{gst_amount}}
          </td>
        </tr>

        <tr>
          <td style="
            padding:12px;
            background:#1d4ed8;
            color:white;
          ">
            <strong>Grand Total</strong>
          </td>

          <td style="
            padding:12px;
            background:#1d4ed8;
            color:white;
            text-align:right;
          ">
            <strong>₹{{total_amount}}</strong>
          </td>
        </tr>

      </table>

    </div>

    <!-- TERMS -->
    <div style="margin-top:35px;">
      <h3>Terms & Conditions</h3>

      <ol style="line-height:1.8;">
        <li>This proposal is valid until {{valid_until}}.</li>
        <li>Government fees are subject to change based on statutory updates.</li>
        <li>Professional fees are payable as per agreed payment terms.</li>
        <li>Work will commence after confirmation and receipt of required documents.</li>
        <li>Any additional work outside the above scope will be charged separately.</li>
      </ol>
    </div>

    <!-- SIGNATURE -->
    <table style="
      width:100%;
      margin-top:50px;
    ">
      <tr>

        <td style="
          width:50%;
          text-align:left;
          vertical-align:bottom;
        ">

          {{#if company_seal}}
          <img
            src="{{company_seal}}"
            crossorigin="anonymous"
            style="
              height:100px;
              max-width:150px;
              object-fit:contain;
            "
          />
          {{/if}}

        </td>

        <td style="
          width:50%;
          text-align:center;
        ">

          <p>
            For <strong>{{company_name}}</strong>
          </p>

          {{#if company_signature}}
          <img
            src="{{company_signature}}"
            crossorigin="anonymous"
            style="
              height:60px;
              max-width:180px;
              object-fit:contain;
            "
          />
          {{/if}}

          <p style="
            margin-top:10px;
            border-top:1px solid #111;
            display:inline-block;
            padding-top:6px;
            min-width:200px;
          ">
            Authorised Signatory
          </p>

        </td>

      </tr>
    </table>

    <!-- FOOTER -->
    <div style="
      margin-top:30px;
      border-top:1px solid #ddd;
      padding-top:10px;
      text-align:center;
      font-size:11px;
      color:#666;
    ">
      This is a system generated proposal issued by {{company_name}}
    </div>

  </div>

</div>
`;

async function updateProposalTemplate() {
    console.log('Updating Proposal template...');
    
    const { data, error } = await supabase
        .from('templates')
        .update({ content: newTemplateContent })
        .ilike('name', '%Proposal%');

    if (error) {
        console.error('Failed to update template:', error);
    } else {
        console.log('Successfully updated Proposal template!');
    }
}

updateProposalTemplate();
