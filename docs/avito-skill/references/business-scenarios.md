# Business Scenarios

Each workflow should produce a business diagnosis and recommended actions, not just raw SDK output. Include required data, reason, expected impact, and risk.

## Listing Health

Use `Ad.list()`, `Ad.get()`, `AdStats.get_item_stats()`, `AdStats.get_item_analytics()`, `AdStats.get_calls_stats()`, and `AdStats.get_account_spendings()`.

Report:

- underperforming active listings;
- strong listings worth scaling;
- high views with low contacts;
- high contacts with weak order or sale progress;
- stale inventory;
- price-change candidates;
- listings needing content, photo, category, location, or delivery fixes before promotion.

## Promotion Decision

Use `AdStats.get_item_stats()`, `AdStats.get_account_spendings()`, `AdPromotion.get_vas_prices()`, `PromotionOrder.list_services()`, `PromotionOrder.list_orders()`, `BbipPromotion.get_suggests()`, `BbipPromotion.get_forecasts()`, `AutostrategyCampaign.create_budget()`, `AutostrategyCampaign.get_stat()`, `TargetActionPricing.get_bids()`, and `TargetActionPricing.get_promotions_by_item_ids()`.

Recommend one of:

- promote;
- do not promote;
- improve listing first;
- stop or reduce spend;
- test lower budget;
- use manual or auto target-action pricing;
- get BBIP forecast or suggests before order creation.

## Paid Promotion Execution

Only after explicit confirmation, use `AdPromotion.apply_vas()`, `AdPromotion.apply_vas_direct()`, `AdPromotion.apply_vas_package()`, `BbipPromotion.create_order()`, `AutostrategyCampaign.create()`, `AutostrategyCampaign.update()`, `AutostrategyCampaign.delete()`, `TargetActionPricing.update_auto()`, `TargetActionPricing.update_manual()`, `TargetActionPricing.delete()`, `TrxPromotion.apply()`, `TrxPromotion.delete()`, or `CpaAuction.create_item_bids()`.

Before execution, show item IDs, service or campaign type, expected cost or budget, forecast or bid data where available, business reason, and reversal or stop option if available.

## Lead Leakage

Use `Chat.list()`, `Chat.get()`, `ChatMessage.list()`, `AdStats.get_calls_stats()`, `CpaCall.list()`, `CpaChat.list()`, and `CallTrackingCall.list()`.

Report unanswered chats, old unread chats, missed calls, slow-response risk, leads by listing, suggested replies, and CPA complaint candidates.

## Messenger Actions

Only after explicit confirmation, use `ChatMessage.send_message()`, `ChatMessage.send_image()`, `ChatMessage.delete()`, `Chat.mark_read()`, `Chat.blacklist()`, `SpecialOfferCampaign.create_multi()`, or `SpecialOfferCampaign.confirm_multi()`.

## Orders, Delivery, Labels, Stock

Use `Order.list()`, `Order.apply()`, `Order.check_confirmation_code()`, `Order.update_tracking_number()`, `OrderLabel.create()`, `OrderLabel.download()`, `Stock.get()`, and `Stock.update()`.

Report orders needing seller action, orders missing tracking, return orders needing acceptance, label generation candidates, stock mismatches, and out-of-stock ads that should not be promoted.

## Reviews And Reputation

Use `Review.list()`, `RatingProfile.get()`, `ReviewAnswer.create()`, and `ReviewAnswer.delete()`.

Report negative reviews without an answer, review themes, rating risk, and draft responses. Only create or delete review answers after explicit confirmation.

## Realty

Use `RealtyAnalyticsReport.get_market_price_correspondence()`, `RealtyAnalyticsReport.get_report_for_classified()`, `RealtyBooking.list_realty_bookings()`, `RealtyBooking.update_bookings_info()`, `RealtyPricing.update_realty_prices()`, `RealtyListing.get_intervals()`, and `RealtyListing.update_base_params()`.

Report overpriced or underpriced objects, booking-calendar gaps, seasonal price-period recommendations, and availability issues.

## Jobs

Use `Vacancy.list()`, `Vacancy.get()`, `Vacancy.get_statuses()`, `Application.list()`, `Application.get_states()`, `Resume.list()`, and `Resume.get_contacts()`.

Report vacancy health, applications needing action, candidate pipeline summary, resume search shortlist, and webhook status. Only create, update, archive, prolong, or auto-renew vacancies after explicit confirmation.

## Account And Team Diagnostics

Use `Account.get_self()`, `Account.get_balance()`, `Account.get_operations_history()`, `AccountHierarchy.get_status()`, `AccountHierarchy.list_employees()`, `AccountHierarchy.list_company_phones()`, `AccountHierarchy.list_items_by_employee()`, and `Tariff.get_tariff_info()`.

Report balance and spend visibility, employee ownership of listings, phone inventory, tariff constraints, and operations-history anomalies.
