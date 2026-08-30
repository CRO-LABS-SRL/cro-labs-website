-- Eseguire una sola volta sul database esistente prima di pubblicare il nuovo server.
ALTER TABLE domain_service_orders
  ADD COLUMN customer_confirmation_sent_at DATETIME NULL AFTER country,
  ADD COLUMN merchant_email_sent_at DATETIME NULL AFTER customer_confirmation_sent_at,
  ADD COLUMN merchant_telegram_sent_at DATETIME NULL AFTER merchant_email_sent_at;
