# SDK Domain Map

Use only `avito-py` from `p141592/avito_python_api` through `avito.AvitoClient`. Domain objects are created from the client, for example:

```python
from avito import AvitoClient

client = AvitoClient.from_env()
account = client.account()
listing = client.ad(item_id=123)
stats = client.ad_stats()
```

The SDK is synchronous and returns typed dataclass-style models. Prefer SDK methods over direct HTTP.

## Account

- `avito.accounts.Account`
  - `get_self()`
  - `get_balance()`
  - `get_operations_history()`
- `avito.accounts.AccountHierarchy`
  - `get_status()`
  - `list_employees()`
  - `list_company_phones()`
  - `list_items_by_employee()`
  - `link_items()`

## Listings And Stats

- `avito.ads.Ad`
  - `list()`
  - `get()`
  - `update_price()`
- `avito.ads.AdStats`
  - `get_item_stats()`
  - `get_item_analytics()`
  - `get_account_spendings()`
  - `get_calls_stats()`
- `avito.ads.AdPromotion`
  - `get_vas_prices()`
  - `apply_vas()`
  - `apply_vas_direct()`
  - `apply_vas_package()`

## Promotion

- `avito.promotion.PromotionOrder`
  - `get_service_dictionary()`
  - `list_services()`
  - `list_orders()`
  - `get_order_status()`
- `avito.promotion.BbipPromotion`
  - `get_suggests()`
  - `get_forecasts()`
  - `create_order()`
- `avito.promotion.AutostrategyCampaign`
  - `create_budget()`
  - `create()`
  - `update()`
  - `get()`
  - `delete()`
  - `list()`
  - `get_stat()`
- `avito.promotion.TargetActionPricing`
  - `get_bids()`
  - `get_promotions_by_item_ids()`
  - `update_auto()`
  - `update_manual()`
  - `delete()`
- `avito.promotion.CpaAuction`
  - `get_user_bids()`
  - `create_item_bids()`
- `avito.promotion.TrxPromotion`
  - `get_commissions()`
  - `apply()`
  - `delete()`

## Leads, Chats, Calls

- `avito.messenger.Chat`
  - `list()`
  - `get()`
  - `mark_read()`
  - `blacklist()`
- `avito.messenger.ChatMessage`
  - `list()`
  - `send_message()`
  - `send_image()`
  - `delete()`
- `avito.messenger.ChatMedia`
  - `get_voice_files()`
  - `upload_images()`
- `avito.messenger.ChatWebhook`
  - `list()`
  - `subscribe()`
  - `unsubscribe()`
- `avito.messenger.SpecialOfferCampaign`
  - `get_available()`
  - `create_multi()`
  - `confirm_multi()`
  - `get_stats()`
  - `get_tariff_info()`
- `avito.cpa.CpaCall`
  - `list()`
  - `create_complaint()`
- `avito.cpa.CpaChat`
  - `get()`
  - `list()`
  - `get_phones_info_from_chats()`
- `avito.cpa.CpaLead`
  - `get_balance_info()`
  - `create_complaint_by_action_id()`
- `avito.cpa.CallTrackingCall`
  - `get()`
  - `list()`
  - `download()`

## Orders, Delivery, Stock

- `avito.orders.Order`
  - `list()`
  - `apply()`
  - `check_confirmation_code()`
  - `set_cnc_details()`
  - `get_courier_delivery_range()`
  - `set_courier_delivery_range()`
  - `update_tracking_number()`
  - `accept_return_order()`
  - `update_markings()`
- `avito.orders.OrderLabel`
  - `create()`
  - `download()`
- `avito.orders.Stock`
  - `get()`
  - `update()`
- `avito.orders.DeliveryOrder`
  - `create()`
  - `create_announcement()`
  - `delete()`
  - `create_change_parcel_result()`
  - `update_change_parcels()`
- `avito.orders.DeliveryTask`
  - `get()`
- `avito.orders.SandboxDelivery`
  - Use only for sandbox delivery workflows.

## Reviews And Ratings

- `avito.ratings.Review`
  - `list()`
- `avito.ratings.ReviewAnswer`
  - `create()`
  - `delete()`
- `avito.ratings.RatingProfile`
  - `get()`

## Realty

- `avito.realty.RealtyAnalyticsReport`
  - `get_market_price_correspondence()`
  - `get_report_for_classified()`
- `avito.realty.RealtyBooking`
  - `list_realty_bookings()`
  - `update_bookings_info()`
- `avito.realty.RealtyPricing`
  - `update_realty_prices()`
- `avito.realty.RealtyListing`
  - `get_intervals()`
  - `update_base_params()`

## Jobs

- `avito.jobs.Vacancy`
  - `list()`
  - `get()`
  - `get_by_ids()`
  - `get_statuses()`
  - `create()`
  - `update()`
  - `delete()`
  - `prolongate()`
  - `update_auto_renewal()`
- `avito.jobs.Application`
  - `list()`
  - `get_states()`
  - `apply()`
  - `update()`
- `avito.jobs.Resume`
  - `list()`
  - `get()`
  - `get_contacts()`
- `avito.jobs.JobWebhook`
  - `get()`
  - `list()`
  - `update()`
  - `delete()`
- `avito.jobs.JobDictionary`
  - `list()`
  - `get()`

## Autoload

- `avito.ads.AutoloadProfile`
  - `get()`
  - `save()`
  - `upload_by_url()`
  - `get_tree()`
  - `get_node_fields()`
- `avito.ads.AutoloadReport`
  - `list()`
  - `get()`
  - `get_last_completed()`
  - `get_items()`
  - `get_items_info()`
  - `get_fees()`
  - `get_ad_ids_by_avito_ids()`
  - `get_avito_ids_by_ad_ids()`

## Tariffs And Automotive

- `avito.tariffs.Tariff`
  - `get_tariff_info()`
- `avito.autoteka.*`
  - Use only for automotive workflows where Autoteka reports, previews, scoring, monitoring, or valuation are directly relevant.
