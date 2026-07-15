// nlu-testset.js — the held-out evaluation set for the CHB NLU model (dev/CI
// only, deploy-excluded). Natural, varied paraphrases, NONE in the training
// corpus — the honest measure of generalisation — plus negatives to reject.
// Wired into search-test.js as the durable accuracy floor; regenerate/extend
// with scratchpad model-bench.js when tuning the model.
exports.HELD = [
  // who owes me money
  ['is anyone in arrears with me', 'who owes me money'],
  ["who hasn't settled up", ['who owes me money', 'balances to chase']],
  ['any invoices still unsettled', ['who owes me money', 'balances to chase']],
  ['which guests are behind on payment', ['who owes me money', 'balances to chase']],
  ['how much money am i still due', 'who owes me money'],
  ['whos behind on their bill', ['who owes me money', 'balances to chase']],
  ['are there debts owed to me', 'who owes me money'],
  ['anybody not squared up yet', ['who owes me money', 'balances to chase']],
  // leaving today
  ['guests going home today', 'leaving today'],
  ['which cottages empty out today', 'leaving today'],
  ['who vacates this morning', 'leaving today'],
  ['guests due to depart', 'leaving today'],
  ['whos packing up and heading off today', 'leaving today'],
  ['any departures on the cards today', 'leaving today'],
  ['who checks out before noon', 'leaving today'],
  // arriving today
  ['who arrives this afternoon', 'arriving today'],
  ['expected guests for tonight', 'arriving today'],
  ['who shows up later today', 'arriving today'],
  ['fresh arrivals due', 'arriving today'],
  ['fresh faces turning up today', 'arriving today'],
  ['whos turning up at the door today', 'arriving today'],
  ['any check ins due today', 'arriving today'],
  // upcoming bookings
  ['what bookings are ahead of us', 'upcoming bookings'],
  ['what reservations lie ahead', 'upcoming bookings'],
  ['who is due to stay next', 'upcoming bookings'],
  ['future guests on the books', 'upcoming bookings'],
  ['whats on the horizon booking wise', 'upcoming bookings'],
  ['reservations coming down the line', 'upcoming bookings'],
  ['what stays are on the way', 'upcoming bookings'],
  // deposits to return
  ['do i owe anyone their deposit back', 'deposits to return'],
  ['damage deposits waiting to go back', 'deposits to return'],
  ['who needs their bond refunded', 'deposits to return'],
  ['deposits i still hold after checkout', 'deposits to return'],
  ['bonds i should be handing back', 'deposits to return'],
  ['security deposits ready to go back', 'deposits to return'],
  ['whose security deposit is due back', 'deposits to return'],
  // balances to chase
  ['who do i need to remind to pay', 'balances to chase'],
  ['payments i should nudge people about', 'balances to chase'],
  ['guests i should prod about paying', 'balances to chase'],
  ['money to collect before arrival', ['balances to chase', 'who owes me money']],
  ['who should i lean on for payment', 'balances to chase'],
  ['anyone i should be pestering about money', ['balances to chase', 'who owes me money']],
  ['whose balance needs chasing up', 'balances to chase'],
  // how many bookings this year
  ['total number of bookings so far this year', 'how many bookings this year'],
  ['count of stays taken this year', 'how many bookings this year'],
  ['how many reservations have we had', 'how many bookings this year'],
  ['number of bookings so far', 'how many bookings this year'],
  ['tally of reservations this year', 'how many bookings this year'],
  ['how many lets so far this year', 'how many bookings this year'],
  // revenue this year
  ['what are my earnings looking like this year', 'revenue this year'],
  ['how much have we brought in', 'revenue this year'],
  ['income for the year to date', 'revenue this year'],
  ['takings so far this season', 'revenue this year'],
  ['whats the years takings', 'revenue this year'],
  ['money brought in so far this year', 'revenue this year'],
  ['gross for the year', 'revenue this year'],
  // occupancy this year
  ['how full have we been', 'occupancy this year'],
  ['how booked up have we been', 'occupancy this year'],
  ['what share of nights were filled', 'occupancy this year'],
  ['how busy were the cottages overall', 'occupancy this year'],
  ['what portion of the calendar got filled', 'occupancy this year'],
  ['how much of the year was occupied', 'occupancy this year'],
  // busiest month
  ['what time of year is strongest', 'busiest month'],
  ['when do we get the most bookings', 'busiest month'],
  ['peak month for stays', 'busiest month'],
  ['which month brings the most guests', 'busiest month'],
  ['when is our rush period', 'busiest month'],
  ['what is our high season month', 'busiest month'],
  // which cottage earns most
  ['which of the cottages performs best', 'which cottage earns most'],
  ['top earning property', 'which cottage earns most'],
  ['which property banks the most', 'which cottage earns most'],
  ['best performing cottage financially', 'which cottage earns most'],
  ['which cottage rakes in the most', 'which cottage earns most'],
  ['what is my most lucrative cottage', 'which cottage earns most'],
  // average nightly rate
  ['average charge for one night', 'average nightly rate'],
  ['usual cost of one night', 'average nightly rate'],
  ['what do we charge on average a night', 'average nightly rate'],
  ['going rate for a single night', 'average nightly rate'],
  ['average tariff per night', 'average nightly rate'],
  ['mean price of a night', 'average nightly rate'],
  // how's business
  ['overall how is everything going', "how's business"],
  ['give me the overall picture', "how's business"],
  ['how are we doing generally', "how's business"],
  ['state of the business right now', "how's business"],
  ['hows the venture holding up', "how's business"],
  ['how healthy is the business', "how's business"],
  // ---- Batch 2: a fresh round of owner-realistic prompts, measured through the
  // full cascade (0 wrong, 1 known abstain) — grows the exam so future changes must
  // keep answering these too. "who's due to arrive soon" is the tolerated abstain.
  ['has anybody not settled their bill yet', ['who owes me money', 'balances to chase']],
  ["who still hasn't paid up", 'who owes me money'],
  ['who is checking out of their cottage today', 'leaving today'],
  ['any guests leaving this morning', 'leaving today'],
  ['who is arriving at the cottages today', 'arriving today'],
  ['any new guests checking in today', 'arriving today'],
  ['what bookings have i got coming', 'upcoming bookings'],
  ["who's due to arrive soon", 'upcoming bookings'],
  ['whose damage deposit do i owe back', 'deposits to return'],
  ['deposits i need to give back', 'deposits to return'],
  ['who should i remind about their balance', 'balances to chase'],
  ['payments i need to nudge', 'balances to chase'],
  ['how many bookings have i taken this year', 'how many bookings this year'],
  ['count of this years stays', 'how many bookings this year'],
  ['what money has come in this year', 'revenue this year'],
  ["what's my income for the year", 'revenue this year'],
  ['how booked up are the cottages', 'occupancy this year'],
  ["what's our occupancy rate", 'occupancy this year'],
  ['what is my busiest month', 'busiest month'],
  ['when do i get the most stays', 'busiest month'],
  ['which of my cottages earns the most', 'which cottage earns most'],
  ['most profitable of my cottages', 'which cottage earns most'],
  ["what's the average price per night", 'average nightly rate'],
  ['typical nightly charge', 'average nightly rate'],
  ['how is the business doing this year', "how's business"],
  ['give me an overview of how were doing', "how's business"],
];
exports.NEG = [
  'sarah pemberton', 'emma richardson', 'oliver hartley', 'jollyboat photos',
  'wifi password for guests', 'seasonal rates grid', 'add booking for smith',
  'hero image', 'newsletter subscribers', 'block jollyboat next weekend',
  'pimpernel description', 'guest wifi details', 'change arrival instructions',
  'newsletter', 'add a booking for jones', 'photo gallery', 'welcome book',
  'check in time settings', 'best beach nearby', 'tide times', 'zzgrmph blat',
  'kitchen inventory', 'email templates', 'crab fishing spots', 'clean the hot tub',
  'connect airbnb calendar', 'gift voucher idea', 'update my phone number',
  'norfolk coast path', 'resend confirmation email', 'change the hero photo',
  'reset my password',
  // In-domain DISTRACTORS — they share vocabulary with an intent ("cottage",
  // "cleaner") but are settings / local-info, not business questions. Each one
  // false-accepted at the lexical tiers until the Darkstar semantic veto
  // (darkstarNoneDominates) landed; they guard that the veto stays effective.
  'edit the cottage description', 'directions to the cottage', 'when does the cleaner come',
  // Cottage FEATURE / policy / directions questions + a card-payment action —
  // they keyword-collide with "which cottage earns most" / "who owes me money"
  // but are facts/actions, not business questions. Rejected via the none-class
  // examples added to CHB_NLU.noneExamples. Fresh wording (NOT the training
  // phrases) so this checks the reject class GENERALISES, not memorises.
  'cottage with a hot tub', 'is the cottage dog friendly', 'can i pay by card',
  // Cottage CAPACITY questions — a feature question ("which cottage sleeps four"),
  // not "which cottage earns most"; rejected via the capacity none-example. Fresh
  // wording so this checks the reject class GENERALISES.
  'which cottage sleeps four', 'how many people can the cottage sleep',
];
