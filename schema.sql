-- Schema chat CRO Labs per MySQL / MariaDB (>= 10.5 / MySQL 8).
-- Eseguire una volta sul database indicato in MYSQL_DATABASE.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  access_token_hash CHAR(64) NOT NULL,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  sender ENUM('visitor', 'operator') NOT NULL,
  body TEXT NOT NULL,
  telegram_message_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id) ON DELETE CASCADE,
  CONSTRAINT chk_chat_messages_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 2000),
  INDEX chat_messages_conversation_created_idx (conversation_id, created_at),
  INDEX chat_messages_telegram_id_idx (telegram_message_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domain_activation_verifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  email VARCHAR(120) NOT NULL,
  code_salt CHAR(32) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  activation_token_hash CHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX domain_activation_email_idx (email, created_at),
  INDEX domain_activation_expiry_idx (expires_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domain_service_orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  verification_id CHAR(36) NOT NULL UNIQUE,
  revolut_order_id CHAR(36) NULL UNIQUE,
  checkout_url TEXT NULL,
  status ENUM('draft', 'pending', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'draft',
  domain VARCHAR(255) NOT NULL,
  plan_years TINYINT UNSIGNED NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  company_name VARCHAR(160) NOT NULL,
  vat_number VARCHAR(32) NOT NULL,
  fiscal_code VARCHAR(32) NULL,
  contact_first_name VARCHAR(80) NOT NULL,
  contact_last_name VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  address VARCHAR(200) NOT NULL,
  city VARCHAR(100) NOT NULL,
  province CHAR(2) NOT NULL,
  postal_code VARCHAR(16) NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'IT',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_domain_order_verification
    FOREIGN KEY (verification_id) REFERENCES domain_activation_verifications (id),
  INDEX domain_service_orders_status_idx (status, created_at),
  INDEX domain_service_orders_domain_idx (domain)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Aggiorna il valore predefinito anche se la tabella esisteva gia; gli ordini storici non cambiano valuta.
ALTER TABLE domain_service_orders MODIFY currency CHAR(3) NOT NULL DEFAULT 'EUR';
