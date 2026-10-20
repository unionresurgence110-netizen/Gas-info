-- GAS-INFO PostgreSQL schema
-- Safe to run on a fresh Neon database. Uses IF NOT EXISTS and does not delete data.
-- IMPORTANT: Authentication, authorization, and password hashing must be enforced by the backend.

BEGIN;

-- 1. User accounts
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer'
        CHECK (role IN ('customer', 'trader', 'admin')),
    account_status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'warning', 'suspended', 'banned')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- 2. Location catalogue. Records are added only from verified/approved location data.
CREATE TABLE IF NOT EXISTS locations (
    location_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    province VARCHAR(120) NOT NULL,
    district VARCHAR(120) NOT NULL,
    municipality VARCHAR(160) NOT NULL,
    ward_no VARCHAR(20),
    town_village VARCHAR(160),
    exact_location VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_locations_hierarchy
    ON locations (province, district, municipality, ward_no, town_village);

-- 3. Trader shops. Map pin is stored separately from the text address.
CREATE TABLE IF NOT EXISTS shops (
    shop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE RESTRICT,
    shop_name VARCHAR(180) NOT NULL,
    phone VARCHAR(40),
    business_email VARCHAR(254),
    province VARCHAR(120) NOT NULL,
    district VARCHAR(120) NOT NULL,
    municipality VARCHAR(160) NOT NULL,
    ward_no VARCHAR(20),
    town_village VARCHAR(160),
    exact_location VARCHAR(255) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    shop_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (shop_status IN ('pending', 'active', 'rejected', 'suspended', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shops_location
    ON shops (province, district, municipality, ward_no, town_village);
CREATE INDEX IF NOT EXISTS idx_shops_coordinates ON shops (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops (shop_status);

-- 4. Current trader-reported stock. No prices or purchase/booking fields are stored.
CREATE TABLE IF NOT EXISTS stock (
    stock_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    cylinder_name VARCHAR(120) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    UNIQUE (shop_id, cylinder_name)
);
CREATE INDEX IF NOT EXISTS idx_stock_cylinder_quantity
    ON stock (cylinder_name, quantity DESC);
CREATE INDEX IF NOT EXISTS idx_stock_updated ON stock (last_updated_at DESC);

-- 5. History of stock changes
CREATE TABLE IF NOT EXISTS stock_update_history (
    update_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    updated_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    cylinder_name VARCHAR(120) NOT NULL,
    previous_quantity INTEGER CHECK (previous_quantity IS NULL OR previous_quantity >= 0),
    new_quantity INTEGER NOT NULL CHECK (new_quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_history_shop_date
    ON stock_update_history (shop_id, updated_at DESC);

-- 6. Shop reviews. One active review per customer per shop is enforced by a partial unique index.
CREATE TABLE IF NOT EXISTS reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'hidden', 'removed', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_one_active_per_customer_shop
    ON reviews (shop_id, user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_reviews_shop_status_date
    ON reviews (shop_id, status, created_at DESC);

-- 7. Website feedback is separate from shop reviews.
CREATE TABLE IF NOT EXISTS website_reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'hidden', 'removed', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_website_reviews_status_date
    ON website_reviews (status, created_at DESC);

-- 8. Customer reports about information accuracy (not a review system).
CREATE TABLE IF NOT EXISTS reports (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    reported_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    report_type VARCHAR(40) NOT NULL
        CHECK (report_type IN ('stock_mismatch', 'incorrect_shop_info', 'other_information_issue')),
    description TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'trader_response_requested', 'under_review', 'resolved', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reports_shop_status_date
    ON reports (shop_id, status, created_at DESC);

-- 9. Trader verification responses and admin decisions for reports.
CREATE TABLE IF NOT EXISTS report_verifications (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'trader_confirmed', 'trader_disputed', 'admin_review', 'resolved')),
    trader_note TEXT,
    admin_note TEXT,
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_report_verifications_report_date
    ON report_verifications (report_id, created_at DESC);

-- 10. In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    type VARCHAR(60) NOT NULL,
    title VARCHAR(180) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_date
    ON notifications (user_id, is_read, created_at DESC);

-- 11. Notification/email processing queue. Actual email delivery requires backend/provider setup.
CREATE TABLE IF NOT EXISTS notification_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    event_type VARCHAR(60) NOT NULL,
    related_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_events_status_date
    ON notification_events (status, created_at);

-- 12. Moderation strikes. Issuing strikes must be authorized by backend/admin rules.
CREATE TABLE IF NOT EXISTS strikes (
    strike_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    related_report_id UUID REFERENCES reports(report_id) ON DELETE SET NULL,
    issued_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'revoked'))
);
CREATE INDEX IF NOT EXISTS idx_strikes_user_status_date
    ON strikes (user_id, status, created_at DESC);

-- 13. Admin moderation audit trail
CREATE TABLE IF NOT EXISTS moderation_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    target_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    target_shop_id UUID REFERENCES shops(shop_id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    reason TEXT NOT NULL,
    related_report_id UUID REFERENCES reports(report_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_date ON moderation_logs (created_at DESC);

-- 14. Future shop images (table prepared for later; image upload feature is not implemented here).
CREATE TABLE IF NOT EXISTS shop_images (
    image_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'rejected', 'removed'))
);
CREATE INDEX IF NOT EXISTS idx_shop_images_shop_status
    ON shop_images (shop_id, status);

-- 15. Email verification tokens. Store only a hash of the token, never the raw token.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verification_user_expiry
    ON email_verification_tokens (user_id, expires_at DESC);

COMMIT;

-- After running, verify tables in Neon SQL Editor with:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
