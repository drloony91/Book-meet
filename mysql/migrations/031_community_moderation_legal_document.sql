ALTER TABLE legal_documents
  MODIFY document_type ENUM('user_agreement', 'privacy_policy', 'personal_data_consent', 'community_moderation_rules') NOT NULL;

ALTER TABLE legal_acceptances
  MODIFY document_type ENUM('user_agreement', 'privacy_policy', 'personal_data_consent', 'community_moderation_rules') NOT NULL;

UPDATE legal_documents
   SET title = CASE language_code
     WHEN 'kk' THEN 'Дербес деректерді жинауға және өңдеуге келісім'
     WHEN 'en' THEN 'Consent to the Collection and Processing of Personal Data'
     ELSE 'Согласие на сбор и обработку персональных данных'
   END
 WHERE document_type = 'personal_data_consent';
