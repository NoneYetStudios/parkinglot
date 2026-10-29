/**
 * Parking Lot V1 - Configuration, Constants, Lots, Modifiers & Comedic Copy
 * A Stab The Finger Game
 */

export const LAYOUT_TEMPLATES = {
  conventional: {
    id: 'conventional',
    name: 'Conventional',
    description: 'Horizontal parking rows with a single entrance along the top or bottom edge.',
    supportedEdges: ['top', 'bottom']
  },
  side: {
    id: 'side',
    name: 'Side Entrance',
    description: 'Perimeter layout with entrance located along the left or right edge.',
    supportedEdges: ['left', 'right']
  },
  multiple: {
    id: 'multiple',
    name: 'Multiple Entrances',
    description: 'Two or more entrances positioned on distinct perimeter edges.',
    supportedEdges: ['top', 'bottom', 'left', 'right']
  },
  sectioned: {
    id: 'sectioned',
    name: 'Sectioned Lot',
    description: 'Divided into distinct parking zones separated by a central driving concourse.',
    supportedEdges: ['top', 'multiple']
  }
};

export const LOTS = {
  dollar: {
    id: 'dollar',
    name: 'Dollar Store',
    subtitle: 'Small Lot • Introductory',
    rows: 4,
    cols: 5,
    totalSpaces: 20,
    basePatience: 100,
    inspectCost: 6,
    hazardPenaltyPatience: 22,
    baseDifficultyMultiplier: 1.0,
    parTimeSeconds: 40,
    maxEfficiencyBonusTime: 14,
    minSafeSpaces: 6,
    targetOccupiedRatio: 0.26,
    targetHazardRatio: 0.24,
    targetBlockedRatio: 0.08,
    entranceCols: [2],
    supportedTemplates: ['conventional'],
    storefrontLabel: 'DOLLAR-ISH GENERAL ("EVERYTHING $1.25 OR SUSPICIOUS")',
    atmosphere:
      'Abandoned carts, faded parking lines, and one inexplicably desirable space directly outside the entrance.',
    description:
      'Small 4×5 grid with straightforward clues, light hazards, and quick decisions.'
  },
  strip: {
    id: 'strip',
    name: 'Strip Mall',
    subtitle: 'Medium Lot • Shared Chaos',
    rows: 6,
    cols: 6,
    totalSpaces: 36,
    basePatience: 105,
    inspectCost: 5,
    hazardPenaltyPatience: 20,
    baseDifficultyMultiplier: 1.35,
    parTimeSeconds: 70,
    maxEfficiencyBonusTime: 20,
    minSafeSpaces: 9,
    targetOccupiedRatio: 0.28,
    targetHazardRatio: 0.25,
    targetBlockedRatio: 0.08,
    entranceCols: [1, 4],
    supportedTemplates: ['conventional', 'side', 'multiple'],
    storefrontLabel: 'PLAZA DEL STRIP: DRY CLEANERS • VAPE TAX • URGENT TACO',
    atmosphere:
      'Shared parking, competing storefronts, carts in unexpected places, and spaces that are great for one store and terrible for every other store.',
    description:
      'Medium 6×6 grid with competing entrances, deeper deduction, and sharper trade-offs between time and convenience.'
  },
  mall: {
    id: 'mall',
    name: 'Major Mall',
    subtitle: 'Large Lot • Suburban Odyssey',
    rows: 7,
    cols: 8,
    totalSpaces: 56,
    basePatience: 115,
    inspectCost: 4,
    hazardPenaltyPatience: 18,
    baseDifficultyMultiplier: 1.75,
    parTimeSeconds: 110,
    maxEfficiencyBonusTime: 26,
    minSafeSpaces: 12,
    targetOccupiedRatio: 0.30,
    targetHazardRatio: 0.26,
    targetBlockedRatio: 0.08,
    entranceCols: [3, 4],
    supportedTemplates: ['conventional', 'side', 'multiple', 'sectioned'],
    storefrontLabel: 'WESTFIELD-ISH GALLERIA & PRETZEL PAVILION',
    atmosphere:
      'Premium spaces near the atrium, distant outer rows in another zip code, crowded lanes, and a walk that makes you question your shopping plans.',
    description:
      'Large 7×8 grid with wide variation in space quality, complex deduction, and higher score potential.'
  },
  stadium: {
    id: 'stadium',
    name: 'Stadium / Event',
    subtitle: 'Huge Lot • Epic Expedition',
    rows: 9,
    cols: 10,
    totalSpaces: 90,
    basePatience: 130,
    inspectCost: 3,
    hazardPenaltyPatience: 16,
    baseDifficultyMultiplier: 2.25,
    parTimeSeconds: 150,
    maxEfficiencyBonusTime: 35,
    minSafeSpaces: 18,
    targetOccupiedRatio: 0.32,
    targetHazardRatio: 0.26,
    targetBlockedRatio: 0.08,
    entranceCols: [3, 6],
    supportedTemplates: ['conventional', 'multiple', 'sectioned'],
    storefrontLabel: 'COLOSSAL MEGA-DOME: GATE A • VIP WILL-CALL • GATE B',
    atmosphere:
      'Tailgaters, tour buses, sea of brake lights, flag-waving superfans, and a spot in Section I that borders the next county.',
    description:
      'Huge 9×10 grid with distant outer lots, intense deduction chains, multiple stadium gates, and maximum score multipliers.'
  }
};

export const MODIFIERS = {
  standard: {
    id: 'standard',
    name: 'Standard',
    shortLabel: 'Standard',
    isBaseline: true,
    multiplierBonus: 0.0,
    description: 'Static hazards, stable clues, baseline accident risk, and standard scoring multiplier.',
    effectSummary: 'Baseline rules • 1.00× modifier multiplier'
  },
  carts: {
    id: 'carts',
    name: 'Cart Chaos',
    shortLabel: '🛒 Cart Chaos',
    isBaseline: false,
    multiplierBonus: 0.25,
    extraCartHazards: 0.07,
    extraBlockedSpaces: 0.04,
    adjacentCartRiskBonus: 0.09,
    description: 'More rogue shopping carts, more blocked or awkward spaces, and extra cart-ding risk during parking.',
    effectSummary: '+25% Score • More loose carts & ding risks'
  },
  badParkers: {
    id: 'badParkers',
    name: 'Bad Parkers',
    shortLabel: '🛻 Bad Parkers',
    isBaseline: false,
    multiplierBonus: 0.30,
    extraBadParkers: 0.08,
    adjacentSqueezeRiskBonus: 0.10,
    description: 'Oversized pickups and line-straddlers spill across painted lines, creating physical squeeze risk even when hazard clues show 0! Check adjacent stalls before committing.',
    effectSummary: '+30% Score • Line-straddlers create squeeze risk even on 0-clue stalls'
  },
  goose: {
    id: 'goose',
    name: 'Goose Patrol',
    shortLabel: '🪿 Goose Patrol',
    isBaseline: false,
    multiplierBonus: 0.35,
    extraGeese: 0.07,
    adjacentGooseRiskBonus: 0.11,
    description: 'Territorial Geese claim prime spaces, glare at nearby drivers, and aggressively audit your parking decisions.',
    effectSummary: '+35% Score • Stationary territorial Geese on patrol'
  }
};

export const QUALITY_TIERS = {
  PREMIUM: {
    id: 'PREMIUM',
    label: 'Excellent',
    stars: '★★★★★',
    starsCount: 5,
    colorClass: 'gold',
    colorHex: '#ffd700',
    shortLabel: '★★★★★ Excellent',
    multiplier: 1.65,
    minScorePoints: 82,
    badgeClass: 'quality-premium',
    tagline: 'The dream spot. Close, clear, convenient.',
    advice: 'A mythical front-row spot. Commit before someone in a crossover sees it.'
  },
  EXCELLENT: {
    id: 'EXCELLENT',
    label: 'Great',
    stars: '★★★★☆',
    starsCount: 4,
    colorClass: 'green',
    colorHex: '#52d273',
    shortLabel: '★★★★☆ Great',
    multiplier: 1.35,
    minScorePoints: 65,
    badgeClass: 'quality-excellent',
    tagline: 'A genuinely good space with few drawbacks.',
    advice: 'A genuinely great spot. Waiting much longer rarely beats this.'
  },
  ACCEPTABLE: {
    id: 'ACCEPTABLE',
    label: 'Good',
    stars: '★★★☆☆',
    starsCount: 3,
    colorClass: 'cyan',
    colorHex: '#36c9ff',
    shortLabel: '★★★☆☆ Good',
    multiplier: 1.05,
    minScorePoints: 48,
    badgeClass: 'quality-acceptable',
    tagline: 'Nothing special, but perfectly reasonable.',
    advice: 'Solid middle-class parking. Good if time is ticking.'
  },
  TECHNICALLY_LEGAL: {
    id: 'TECHNICALLY_LEGAL',
    label: 'Tight',
    stars: '★★☆☆☆',
    starsCount: 2,
    colorClass: 'orange',
    colorHex: '#ff9d3a',
    shortLabel: '★★☆☆☆ Tight',
    multiplier: 0.80,
    minScorePoints: 30,
    badgeClass: 'quality-legal',
    tagline: 'You can park here. Your passengers may complain.',
    advice: 'Safe and legal, though you will definitely get your steps in.'
  },
  DEEPLY_UNFORTUNATE: {
    id: 'DEEPLY_UNFORTUNATE',
    label: 'Risky',
    stars: '★☆☆☆☆',
    starsCount: 1,
    colorClass: 'red',
    colorHex: '#ff5a5a',
    shortLabel: '★☆☆☆☆ Risky',
    multiplier: 0.55,
    minScorePoints: 0,
    badgeClass: 'quality-unfortunate',
    tagline: 'You found a space. That is about all it has going for it.',
    advice: 'Only take this if your patience is evaporating.'
  }
};

export const CELL_TYPES = {
  SAFE: 'SAFE',
  OCCUPIED: 'OCCUPIED',
  BLOCKED: 'BLOCKED',
  HAZARD: 'HAZARD'
};

export const HAZARD_SUBTYPES = {
  CART: {
    id: 'CART',
    name: 'Feral Shopping Cart',
    shortLabel: 'Loose Cart',
    icon: '🛒',
    riskContribution: 0.10,
    descriptions: [
      'A rogue shopping cart with one violently wobbling wheel sits dead center.',
      'Three nested carts fused together by a mystery sticky substance.',
      'An abandoned cart parked diagonally with more confidence than most sedans.'
    ]
  },
  GOOSE: {
    id: 'GOOSE',
    name: 'The Goose',
    shortLabel: 'The Goose',
    icon: '🪿',
    riskContribution: 0.13,
    descriptions: [
      'The Goose has claimed this space. The Goose does not need a vehicle.',
      'The Goose stands in the exact center of the stall, daring you to make eye contact.',
      'The Goose is conducting an unscheduled inspection of the asphalt.'
    ]
  },
  ETERNAL_REVERSE: {
    id: 'ETERNAL_REVERSE',
    name: 'Eternal Reverse Lights',
    shortLabel: 'Backing Up Forever',
    icon: '🚨',
    riskContribution: 0.11,
    descriptions: [
      'A sedan whose reverse lights have been on since 2019. They are not moving.',
      'Driver is backing out at 0.02 mph while checking seventeen mirrors.',
      'Reverse lights glowing brightly while the driver eats soup inside.'
    ]
  },
  MYSTERY_STAIN: {
    id: 'MYSTERY_STAIN',
    name: 'Suspicious Fluid Anomaly',
    shortLabel: 'Mystery Stain',
    icon: '🛢️',
    riskContribution: 0.08,
    descriptions: [
      'An iridescent puddle that appears to be dissolving the yellow paint.',
      'A geometry of broken tail-light plastic and legacy transmission fluid.',
      'A pothole filled with what looks like cursed slushie syrup.'
    ]
  }
};

export const OBSTACLE_SUBTYPES = {
  SEDAN: {
    id: 'SEDAN',
    name: 'Sensible Sedan',
    shortLabel: 'Occupied',
    isBadParker: false,
    riskContribution: 0.02,
    description: 'Already occupied by someone who arrived four minutes before you.'
  },
  OVERSIZED_TRUCK: {
    id: 'OVERSIZED_TRUCK',
    name: 'Canyonero Duallie 4500',
    shortLabel: 'Oversized Pickup',
    isBadParker: true,
    riskContribution: 0.11,
    description: 'Extended cab, tow mirrors deployed to full wingspan, trailer hitch jutting into the lane.'
  },
  LINE_STRADDLER: {
    id: 'LINE_STRADDLER',
    name: 'Diagonal Luxury Coupe',
    shortLabel: 'Double-Parked',
    isBadParker: true,
    riskContribution: 0.12,
    description: 'Parked at a bold 27-degree angle across the painted line to "protect the doors."'
  },
  CONCRETE_PILLAR: {
    id: 'CONCRETE_PILLAR',
    name: 'Inexplicable Light Pole',
    shortLabel: 'Blocked (Pole)',
    isBadParker: false,
    riskContribution: 0.06,
    description: 'Civil engineers placed a four-foot yellow concrete bollard directly inside this space.'
  },
  CART_CORRAL_OVERFLOW: {
    id: 'CART_CORRAL_OVERFLOW',
    name: 'Cart Corral Overflow',
    shortLabel: 'Blocked (Carts)',
    isBadParker: false,
    riskContribution: 0.08,
    description: 'People brought their carts *near* the corral, then gave up on society.'
  }
};

export const ACCIDENT_OUTCOMES = {
  CLEAN: {
    id: 'CLEAN',
    title: 'Clean Park',
    isAccident: false,
    penalty: 0,
    deductible: 0,
    badgeClass: 'outcome-clean',
    messages: [
      'Crisp alignment. Equal margin on both sides. Nobody had to climb out the sunroof.',
      'Parked in a single fluid motion. A passerby nodded with quiet respect.',
      'Zero paint transfer. Your insurance agent remains blissfully unaware of your existence.'
    ]
  },
  AWKWARD: {
    id: 'AWKWARD',
    title: 'Awkward But Successful Park',
    isAccident: false,
    penalty: 35,
    deductible: 0,
    badgeClass: 'outcome-awkward',
    messages: [
      'No damage to the vehicle. Your dignity is another matter.',
      'It took a four-point correction in front of two witnesses, but you are legally between the lines.',
      'You parked slightly crooked, got out, looked at it, sighed, and decided to live with it.'
    ]
  },
  CART_COLLISION: {
    id: 'CART_COLLISION',
    title: 'Shopping Cart Collision',
    isAccident: true,
    penalty: 160,
    deductible: 100,
    badgeClass: 'outcome-accident',
    messages: [
      'The cart was not insured. You, unfortunately, are.',
      'A rogue shopping cart introduced itself to your front quarter panel at point-blank range.',
      'Metallic clang heard across three rows. The cart rolled away unscathed.'
    ]
  },
  FENDER_BENDER: {
    id: 'FENDER_BENDER',
    title: 'Minor Fender Bender',
    isAccident: true,
    penalty: 240,
    deductible: 200,
    badgeClass: 'outcome-accident',
    messages: [
      'Your deductible would like a word.',
      'You have successfully converted a parking space into an insurance claim.',
      'The Goose has witnessed the incident. The Goose will not be a reliable witness.'
    ]
  },
  SERIOUS_MISHAP: {
    id: 'SERIOUS_MISHAP',
    title: 'Serious Parking Mishap',
    isAccident: true,
    penalty: 380,
    deductible: 300,
    badgeClass: 'outcome-severe',
    messages: [
      'You have successfully converted a parking space into an insurance claim.',
      'You clipped an oversized bumper, nudged a cart into a light pole, and set off two car alarms.',
      'Your insurance adjuster just felt a cold shiver down their spine.'
    ]
  }
};

export const GOOSE_QUIPS = {
  welcome: [
    'The Goose is observing the lot. The Goose approves of nothing.',
    'The Goose does not need a vehicle. The Goose owns every space spiritually.',
    'The Goose is already judging your turn signal usage.'
  ],
  roundStart: [
    'The Goose watches you enter the lot. The Goose has seen better optimism.',
    'The Goose has claimed at least one prime space. Good luck finding the rest.',
    'The Goose notes your arrival time and begins silent judgment.'
  ],
  inspectSafePremium: [
    'The Goose sees you eyeing the front row. The Goose narrows its eyes.',
    'A Premium space. The Goose thinks you do not deserve it.',
    'The Goose admits that space is convenient, then honks dismissively.'
  ],
  inspectSafeOrdinary: [
    'The Goose is judging your parking options.',
    'An ordinary space for an ordinary driver. The Goose is unmoved.',
    'The Goose flaps one wing slowly. "Adequate," says the posture.'
  ],
  inspectSafeBad: [
    'That space is in another time zone. The Goose respects the cardio.',
    'The Goose looks at that distant corner space and honks with dry amusement.'
  ],
  inspectOccupied: [
    'Taken. The Goose knew that five minutes ago.',
    'Someone beat you to it. The Goose offers zero sympathy.'
  ],
  inspectHazardGoose: [
    'HONK! The Goose has claimed this space. The Goose does not need a vehicle.',
    'HONK! You have disturbed The Goose. Your patience suffers accordingly.',
    'The Goose glares through your windshield. This space is permanently occupied by feathers and spite.'
  ],
  inspectHazardOther: [
    'A hazard. The Goose watched that cart roll there twenty minutes ago and did nothing.',
    'The Goose observes your growing frustration with serene satisfaction.'
  ],
  lowPatience: [
    'Your patience is wearing thin. The Goose thrives on parking-lot desperation.',
    'The Goose hears you sighing at the steering wheel.'
  ],
  resultClean: [
    'You parked successfully. The Goose is not celebrating.',
    'Insurance penalty: zero. The Goose remains unconvinced.',
    'The Goose watched the whole maneuver. 6/10 for posture.'
  ],
  resultAwkward: [
    'The Goose counted how many times you shifted into reverse.',
    'You are technically inside the lines. The Goose is Measuring Tape Certified and skeptical.'
  ],
  resultAccident: [
    'The Goose has reviewed your insurance claim. The Goose has questions.',
    'The Goose has witnessed the incident. The Goose will not be a reliable witness.',
    'HONK. The Goose is writing down your license plate with its beak.'
  ],
  resultPatienceFail: [
    'You ran out of patience and drove home. The Goose wins by default.',
    'Another driver broken by the lot. The Goose preens victoriously.'
  ]
};
