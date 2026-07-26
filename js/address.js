import { supabase, safeQuery, friendlyErrorMessage } from './supabase-client.js';

const form = document.getElementById('address-form');
const errorBox = document.getElementById('address-error');
const stepForm = document.getElementById('step-form');
const stepDone = document.getElementById('step-done');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(form);

  const { error } = await safeQuery(supabase.rpc('submit_address_entry', {
    p_household: formData.get('field-household'),
    p_title: formData.get('field-title'),
    p_first_name: formData.get('field-first-name'),
    p_last_name: formData.get('field-last-name'),
    p_address_line1: formData.get('field-address1'),
    p_address_line2: formData.get('field-address2') || null,
    p_city: formData.get('field-city'),
    p_state: formData.get('field-state'),
    p_zip: formData.get('field-zip'),
    p_email: formData.get('field-email'),
    p_phone: formData.get('field-phone'),
  }));

  if (error) {
    console.error(error);
    showError(friendlyErrorMessage(error, 'Something went wrong saving your address. Please try again.'));
    return;
  }

  clearError();
  stepForm.hidden = true;
  stepDone.hidden = false;
});
