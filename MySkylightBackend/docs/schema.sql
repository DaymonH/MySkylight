-- AUTO-GENERATED — do not edit by hand.
-- Regenerate with `make schema` (or `python scripts/dump_schema.py`) after any
-- model/migration change. Built by applying the full Alembic chain to a fresh DB.
-- Source of truth = app/models/*.py + alembic/versions/; this is a convenience mirror.
-- Alembic head: 018

CREATE TABLE event_assignments (
	id CHAR(32) NOT NULL, 
	event_id CHAR(32) NOT NULL, 
	member_id CHAR(32) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	FOREIGN KEY(member_id) REFERENCES members (id), 
	UNIQUE (event_id, member_id)
);
CREATE INDEX ix_event_assignments_event_id ON event_assignments (event_id);
CREATE INDEX ix_event_assignments_member_id ON event_assignments (member_id);

CREATE TABLE event_exceptions (
	id CHAR(32) NOT NULL, 
	event_id CHAR(32) NOT NULL, 
	original_date DATE NOT NULL, 
	is_cancelled BOOLEAN DEFAULT '0' NOT NULL, 
	title VARCHAR(500), 
	description TEXT, 
	location VARCHAR(500), 
	start_dt DATETIME, 
	end_dt DATETIME, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES events (id), 
	UNIQUE (event_id, original_date)
);
CREATE INDEX ix_event_exceptions_event_id ON event_exceptions (event_id);

CREATE TABLE "events" (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	title VARCHAR(500) NOT NULL, 
	description TEXT, 
	location VARCHAR(500), 
	start_dt DATETIME NOT NULL, 
	end_dt DATETIME NOT NULL, 
	all_day BOOLEAN DEFAULT '0' NOT NULL, 
	rrule VARCHAR(1000), 
	color VARCHAR(7), 
	is_countdown BOOLEAN DEFAULT '0' NOT NULL, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	deleted_at DATETIME, 
	ical_uid VARCHAR(500), 
	external_calendar_id CHAR(32), 
	PRIMARY KEY (id), 
	CONSTRAINT fk_events_external_calendar_id FOREIGN KEY(external_calendar_id) REFERENCES external_calendars (id), 
	FOREIGN KEY(family_id) REFERENCES families (id)
);
CREATE INDEX ix_events_external_calendar_id ON events (external_calendar_id);
CREATE INDEX ix_events_family_id ON events (family_id);
CREATE INDEX ix_events_ical_uid ON events (ical_uid);

CREATE TABLE external_accounts (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	provider VARCHAR(6) NOT NULL, 
	account_email VARCHAR(320), 
	access_token TEXT, 
	refresh_token TEXT, 
	token_expiry DATETIME, 
	scopes TEXT, 
	status VARCHAR(12) DEFAULT 'active' NOT NULL, 
	last_synced_at DATETIME, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	UNIQUE (family_id, provider, account_email)
);
CREATE INDEX ix_external_accounts_family_id ON external_accounts (family_id);

CREATE TABLE "external_calendars" (
	id CHAR(32) NOT NULL, 
	account_id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	external_id VARCHAR(512) NOT NULL, 
	name VARCHAR(512) NOT NULL, 
	color VARCHAR(7), 
	sync_token TEXT, 
	last_synced_at DATETIME, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	synced BOOLEAN DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	UNIQUE (account_id, external_id), 
	FOREIGN KEY(account_id) REFERENCES external_accounts (id)
);
CREATE INDEX ix_external_calendars_account_id ON external_calendars (account_id);
CREATE INDEX ix_external_calendars_family_id ON external_calendars (family_id);

CREATE TABLE families (
	id CHAR(32) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	lock_enabled BOOLEAN DEFAULT '0' NOT NULL, 
	lock_pin_hash VARCHAR(255), 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, timezone VARCHAR(64) DEFAULT 'America/Denver' NOT NULL, weather_lat FLOAT, weather_lng FLOAT, weather_label VARCHAR(120), 
	PRIMARY KEY (id)
);

CREATE TABLE invitations (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	invited_by_id CHAR(32) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	role VARCHAR(6) DEFAULT 'adult' NOT NULL, 
	token VARCHAR(64) NOT NULL, 
	status VARCHAR(8) DEFAULT 'pending' NOT NULL, 
	expires_at DATETIME NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, member_id CHAR(32), 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	FOREIGN KEY(invited_by_id) REFERENCES users (id), 
	UNIQUE (token)
);
CREATE INDEX ix_invitations_email ON invitations (email);

CREATE TABLE list_items (
	id CHAR(32) NOT NULL, 
	list_id CHAR(32) NOT NULL, 
	text VARCHAR(500) NOT NULL, 
	quantity VARCHAR(50), 
	category VARCHAR(100), 
	is_checked BOOLEAN DEFAULT 0 NOT NULL, 
	checked_at DATETIME, 
	assignee_member_id CHAR(32), 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(list_id) REFERENCES lists (id), 
	FOREIGN KEY(assignee_member_id) REFERENCES members (id)
);
CREATE INDEX ix_list_items_assignee_member_id ON list_items (assignee_member_id);
CREATE INDEX ix_list_items_list_id ON list_items (list_id);

CREATE TABLE lists (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	list_type VARCHAR(7) DEFAULT 'todo' NOT NULL, 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id)
);
CREATE INDEX ix_lists_family_id ON lists (family_id);

CREATE TABLE meal_plans (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	date DATE NOT NULL, 
	slot VARCHAR(9) NOT NULL, 
	recipe_id CHAR(32), 
	title VARCHAR(200), 
	calendar_event_id CHAR(32), 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	FOREIGN KEY(recipe_id) REFERENCES recipes (id)
);
CREATE INDEX ix_meal_plans_date ON meal_plans (date);
CREATE INDEX ix_meal_plans_family_id ON meal_plans (family_id);
CREATE INDEX ix_meal_plans_recipe_id ON meal_plans (recipe_id);

CREATE TABLE members (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	user_id CHAR(32), 
	name VARCHAR(100) NOT NULL, 
	color VARCHAR(7) DEFAULT '#6366f1' NOT NULL, 
	avatar_url VARCHAR(2048), 
	pin_hash VARCHAR(255), 
	is_child BOOLEAN DEFAULT '0' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE INDEX ix_members_family_id ON members (family_id);
CREATE INDEX ix_members_user_id ON members (user_id);

CREATE TABLE memberships (
	id CHAR(32) NOT NULL, 
	user_id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	role VARCHAR(6) DEFAULT 'adult' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	UNIQUE (user_id, family_id)
);

CREATE TABLE recipe_ingredients (
	id CHAR(32) NOT NULL, 
	recipe_id CHAR(32) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	quantity FLOAT, 
	unit VARCHAR(50), 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, section VARCHAR(100), 
	PRIMARY KEY (id), 
	FOREIGN KEY(recipe_id) REFERENCES recipes (id)
);
CREATE INDEX ix_recipe_ingredients_recipe_id ON recipe_ingredients (recipe_id);

CREATE TABLE recipes (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	description TEXT, 
	instructions TEXT, 
	image_url VARCHAR(1000), 
	servings INTEGER, 
	tags JSON DEFAULT '[]' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, prep_minutes INTEGER, cook_minutes INTEGER, source_url VARCHAR(1000), 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id)
);
CREATE INDEX ix_recipes_family_id ON recipes (family_id);

CREATE TABLE redemptions (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	reward_id CHAR(32) NOT NULL, 
	member_id CHAR(32) NOT NULL, 
	star_cost INTEGER NOT NULL, 
	status VARCHAR(8) DEFAULT 'pending' NOT NULL, 
	decided_at DATETIME, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	FOREIGN KEY(reward_id) REFERENCES rewards (id), 
	FOREIGN KEY(member_id) REFERENCES members (id)
);
CREATE INDEX ix_redemptions_family_id ON redemptions (family_id);
CREATE INDEX ix_redemptions_member_id ON redemptions (member_id);
CREATE INDEX ix_redemptions_reward_id ON redemptions (reward_id);

CREATE TABLE reminders (
	id CHAR(32) NOT NULL, 
	event_id CHAR(32) NOT NULL, 
	minutes_before INTEGER DEFAULT '15' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES events (id)
);
CREATE INDEX ix_reminders_event_id ON reminders (event_id);

CREATE TABLE rewards (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	description TEXT, 
	star_cost INTEGER NOT NULL, 
	icon VARCHAR(16), 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	is_active BOOLEAN DEFAULT 1 NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id)
);
CREATE INDEX ix_rewards_family_id ON rewards (family_id);

CREATE TABLE routines (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id)
);
CREATE INDEX ix_routines_family_id ON routines (family_id);

CREATE TABLE task_assignments (
	id CHAR(32) NOT NULL, 
	task_id CHAR(32) NOT NULL, 
	member_id CHAR(32) NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, sort_order INTEGER DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES tasks (id), 
	FOREIGN KEY(member_id) REFERENCES members (id), 
	UNIQUE (task_id, member_id)
);
CREATE INDEX ix_task_assignments_member_id ON task_assignments (member_id);
CREATE INDEX ix_task_assignments_task_id ON task_assignments (task_id);

CREATE TABLE task_completions (
	id CHAR(32) NOT NULL, 
	task_id CHAR(32) NOT NULL, 
	member_id CHAR(32) NOT NULL, 
	occurrence_date DATE NOT NULL, 
	completed_at DATETIME NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, stars_awarded INTEGER DEFAULT '0' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES tasks (id), 
	FOREIGN KEY(member_id) REFERENCES members (id), 
	UNIQUE (task_id, member_id, occurrence_date)
);
CREATE INDEX ix_task_completions_member_id ON task_completions (member_id);
CREATE INDEX ix_task_completions_occurrence_date ON task_completions (occurrence_date);
CREATE INDEX ix_task_completions_task_id ON task_completions (task_id);

CREATE TABLE task_rotation_overrides (
	id CHAR(32) NOT NULL, 
	task_id CHAR(32) NOT NULL, 
	occurrence_date DATE NOT NULL, 
	member_id CHAR(32), 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES tasks (id), 
	FOREIGN KEY(member_id) REFERENCES members (id), 
	UNIQUE (task_id, occurrence_date)
);
CREATE INDEX ix_task_rotation_overrides_member_id ON task_rotation_overrides (member_id);
CREATE INDEX ix_task_rotation_overrides_occurrence_date ON task_rotation_overrides (occurrence_date);
CREATE INDEX ix_task_rotation_overrides_task_id ON task_rotation_overrides (task_id);

CREATE TABLE tasks (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	routine_id CHAR(32), 
	title VARCHAR(200) NOT NULL, 
	description TEXT, 
	color VARCHAR(7), 
	start_date DATE NOT NULL, 
	rrule VARCHAR(1000), 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, assignment_strategy VARCHAR(8) DEFAULT 'fixed' NOT NULL, star_value INTEGER DEFAULT '1' NOT NULL, rotation_unit VARCHAR(10) DEFAULT 'occurrence' NOT NULL, rotation_interval INTEGER DEFAULT '1' NOT NULL, rotation_anchor_date DATE, estimated_minutes INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	FOREIGN KEY(routine_id) REFERENCES routines (id)
);
CREATE INDEX ix_tasks_family_id ON tasks (family_id);
CREATE INDEX ix_tasks_routine_id ON tasks (routine_id);

CREATE TABLE users (
	id CHAR(32) NOT NULL, 
	clerk_user_id VARCHAR(255) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	first_name VARCHAR(255), 
	last_name VARCHAR(255), 
	image_url VARCHAR(2048), 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	deleted_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (clerk_user_id), 
	UNIQUE (email)
);
CREATE INDEX ix_users_clerk_user_id ON users (clerk_user_id);
CREATE INDEX ix_users_email ON users (email);

CREATE TABLE weather_cache (
	id CHAR(32) NOT NULL, 
	family_id CHAR(32) NOT NULL, 
	location_key VARCHAR(64) NOT NULL, 
	forecast_date DATE NOT NULL, 
	data TEXT NOT NULL, 
	fetched_at DATETIME NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(family_id) REFERENCES families (id), 
	UNIQUE (family_id, location_key, forecast_date)
);
CREATE INDEX ix_weather_cache_family_id ON weather_cache (family_id);
CREATE INDEX ix_weather_cache_forecast_date ON weather_cache (forecast_date);
