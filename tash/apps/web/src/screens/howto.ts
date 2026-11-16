import type { GameId } from '@tash/engine';
import type { Lang } from '../app/settings';

export interface HowToSection {
  title: string;
  points: string[];
}

/** Rules pages, written from the rules the engine implements. */
export const HOW_TO: Record<GameId, Record<Lang, HowToSection[]>> = {
  callbridge: {
    en: [
      {
        title: 'Goal',
        points: [
          'Four players, each for themselves. Each round you call how many tricks you will win, then try to win exactly that many.',
          'Highest total after the last round wins (5 rounds by default).',
        ],
      },
      {
        title: 'Deal and calling',
        points: [
          'All 52 cards are dealt, 13 each. Ace is high, 2 is low. Spades are always trump.',
          'Starting after the dealer, each player calls a number of tricks from 1 to 13. Calls are public and do not have to add up to anything.',
        ],
      },
      {
        title: 'Playing a trick',
        points: [
          'The player after the dealer leads the first trick. Any card may be led, even a spade.',
          'You must follow the led suit if you can.',
          'If you cannot follow suit and you hold a spade that beats every spade already in the trick, you must play one.',
          'Otherwise you may play any card. The highest spade wins; if no spade was played, the highest card of the led suit wins. The winner leads next.',
        ],
      },
      {
        title: 'Scoring',
        points: [
          'Win exactly your call, or one more, and you score your call. Anything else and you lose your call.',
          'A successful call of 8 or more scores 13.',
          'The host can switch to the 0.1-per-extra-trick scoring used by many apps.',
        ],
      },
    ],
    bn: [
      {
        title: 'লক্ষ্য',
        points: [
          'চারজন খেলোয়াড়, প্রত্যেকে নিজের জন্য। প্রতি রাউন্ডে আপনি কয়টা পিঠ নেবেন তা ডাকবেন, তারপর ঠিক ততগুলো নেওয়ার চেষ্টা করবেন।',
          'শেষ রাউন্ডের পর যার মোট স্কোর সবচেয়ে বেশি সে জিতবে (ডিফল্ট ৫ রাউন্ড)।',
        ],
      },
      {
        title: 'বাটা ও কল',
        points: [
          '৫২টি তাস সবাইকে ১৩টি করে বাটা হয়। টেক্কা সবচেয়ে বড়, দুরি সবচেয়ে ছোট। ইস্কাপন সবসময় তুরুপ।',
          'ডিলারের পরের জন থেকে শুরু করে প্রত্যেকে ১ থেকে ১৩ পর্যন্ত কল দেয়। কল সবাই দেখতে পায়, যোগফল কিছু হতে হবে না।',
        ],
      },
      {
        title: 'পিঠ খেলা',
        points: [
          'ডিলারের পরের জন প্রথম পিঠ শুরু করে। যেকোনো তাস দিয়ে শুরু করা যায়, ইস্কাপনও।',
          'যে রং চালা হয়েছে, থাকলে সেই রং দিতেই হবে।',
          'রং না থাকলে, আর হাতে এমন ইস্কাপন থাকলে যা পিঠে থাকা সব ইস্কাপনকে হারায়, তবে সেটি দিতেই হবে।',
          'নইলে যেকোনো তাস দেওয়া যায়। সবচেয়ে বড় ইস্কাপন পিঠ জেতে; ইস্কাপন না পড়লে চালা রঙের সবচেয়ে বড় তাস জেতে। বিজয়ী পরের পিঠ চালে।',
        ],
      },
      {
        title: 'স্কোর',
        points: [
          'ঠিক কল পরিমাণ বা একটি বেশি পিঠ নিলে কল পরিমাণ পয়েন্ট পাবেন। অন্য কিছু হলে কল পরিমাণ পয়েন্ট কাটা যাবে।',
          '৮ বা তার বেশি কল সফল হলে ১৩ পয়েন্ট।',
          'হোস্ট চাইলে প্রতি বাড়তি পিঠে ০.১ পয়েন্টের নিয়ম চালু করতে পারেন।',
        ],
      },
    ],
  },
  twentynine: {
    en: [
      {
        title: 'Goal',
        points: [
          'Two teams of two; partners sit opposite. The bidding team must collect at least as many card points as it bid.',
          'Win a round: +1 game point. Lose it: −1. The first team to +6 wins; a team that falls to −6 loses.',
        ],
      },
      {
        title: 'Cards and points',
        points: [
          '32 cards: 7 to Ace in each suit. In every suit the order is J, 9, A, 10, K, Q, 8, 7.',
          'Jack = 3, Nine = 2, Ace = 1, Ten = 1, others 0. That makes 28, plus 1 for the last trick = 29.',
        ],
      },
      {
        title: 'Bidding and trump',
        points: [
          'Everyone gets 4 cards. Starting after the dealer, players bid from 16 to 28 or pass. A pass is final. Bidding ends when three players have passed.',
          'If the first three players all pass, the dealer must bid 16.',
          'The winning bidder secretly chooses the trump suit. Then everyone gets 4 more cards.',
        ],
      },
      {
        title: 'Play',
        points: [
          'The player after the dealer leads. Follow suit if you can.',
          'While trump is hidden, a player who cannot follow suit can either play any card, or ask for trump. Asking reveals it to everyone, and the asker must then play a trump if they have one.',
          'Before the reveal, trump cards have no special power. After it, the highest trump wins the trick, otherwise the highest card of the led suit.',
        ],
      },
      {
        title: 'Pair',
        points: [
          'King and Queen of trump in one hand is a Pair. It is declared automatically when that team wins a trick after the reveal.',
          'If the bidding team holds it, their target drops by 4 (not below 16). If the defenders hold it, the target rises by 4 (not above 28).',
        ],
      },
    ],
    bn: [
      {
        title: 'লক্ষ্য',
        points: [
          'দুইজন করে দুই দল; সঙ্গী বসে মুখোমুখি। ডাক দেওয়া দলকে অন্তত ডাকের সমান পয়েন্ট তুলতে হবে।',
          'রাউন্ড জিতলে +১ গেম পয়েন্ট, হারলে −১। যে দল প্রথমে +৬ করবে সে জিতবে; −৬ হলে হার।',
        ],
      },
      {
        title: 'তাস ও পয়েন্ট',
        points: [
          '৩২টি তাস: প্রতিটি রঙে ৭ থেকে টেক্কা। প্রতিটি রঙে ক্রম: গোলাম, নয়, টেক্কা, দশ, সাহেব, বিবি, আট, সাত।',
          'গোলাম = ৩, নয় = ২, টেক্কা = ১, দশ = ১, বাকি ০। মোট ২৮, শেষ পিঠে আরো ১ = ২৯।',
        ],
      },
      {
        title: 'ডাক ও তুরুপ',
        points: [
          'সবাই ৪টি তাস পায়। ডিলারের পরের জন থেকে ১৬ থেকে ২৮ পর্যন্ত ডাক বা পাস। পাস দিলে আর ডাকা যায় না। তিনজন পাস দিলে ডাক শেষ।',
          'প্রথম তিনজন সবাই পাস দিলে ডিলারকে ১৬ ডাকতে হবে।',
          'ডাকজয়ী গোপনে তুরুপ বাছে। তারপর সবাই আরো ৪টি তাস পায়।',
        ],
      },
      {
        title: 'খেলা',
        points: [
          'ডিলারের পরের জন চালে। রং থাকলে রং দিতে হবে।',
          'তুরুপ লুকানো থাকা অবস্থায় রং না থাকলে যেকোনো তাস দেওয়া যায়, অথবা তুরুপ চাওয়া যায়। চাইলে সবার সামনে তুরুপ খোলে, আর যে চাইল তার হাতে তুরুপ থাকলে তুরুপই দিতে হবে।',
          'খোলার আগে তুরুপের কোনো বিশেষ ক্ষমতা নেই। খোলার পরে সবচেয়ে বড় তুরুপ পিঠ জেতে, না হলে চালা রঙের সবচেয়ে বড় তাস।',
        ],
      },
      {
        title: 'পেয়ার',
        points: [
          'এক হাতে তুরুপের সাহেব আর বিবি থাকলে পেয়ার। তুরুপ খোলার পরে সেই দল পিঠ জিতলে এটি নিজে থেকেই দেখানো হয়।',
          'ডাক দেওয়া দলের পেয়ার হলে লক্ষ্য ৪ কমে (১৬-এর নিচে নয়)। প্রতিপক্ষের হলে লক্ষ্য ৪ বাড়ে (২৮-এর বেশি নয়)।',
        ],
      },
    ],
  },
  hazari: {
    en: [
      {
        title: 'Goal',
        points: ['Four players, each for themselves. Win the most valuable cards over several deals. The first to reach 1000 points wins.'],
      },
      {
        title: 'Arranging',
        points: [
          'Each player gets 13 cards and splits them into three groups of 3 and one group of 4.',
          'Groups go strongest first: group 1 must be at least as strong as group 2, and so on. Everyone arranges at the same time, then the groups are compared.',
        ],
      },
      {
        title: 'Combinations (strongest first)',
        points: [
          'Troy: three of a kind. AAA is best.',
          'Colour run: three in sequence, same suit.',
          'Run: three in sequence, mixed suits. A-K-Q is highest, A-2-3 second, then K-Q-J down to 4-3-2. K-A-2 is not a run.',
          'Colour: three of the same suit.',
          'Pair: two of the same rank.',
          'Indi: anything else, compared by the highest card.',
          'The group of 4 counts as the best 3-card combination inside it; its fourth card only breaks ties.',
        ],
      },
      {
        title: 'Showdown and points',
        points: [
          'Group 1 from every player is compared, then group 2, and so on. The strongest group wins all the cards in that round. If two groups are exactly equal, the one played later wins.',
          'A, K, Q, J and 10 are worth 10 points; 9 down to 2 are worth 5. Each deal has 360 points.',
        ],
      },
    ],
    bn: [
      {
        title: 'লক্ষ্য',
        points: ['চারজন খেলোয়াড়, প্রত্যেকে নিজের জন্য। কয়েক দানে দামি তাস জিতে নিন। প্রথমে যে ১০০০ পয়েন্টে পৌঁছাবে সে জিতবে।'],
      },
      {
        title: 'সাজানো',
        points: [
          'প্রত্যেকে ১৩টি তাস পায় এবং ৩টি করে তিন ভাগ আর ৪টির এক ভাগে সাজায়।',
          'শক্তিশালী ভাগ আগে: ভাগ ১ অন্তত ভাগ ২-এর সমান শক্তিশালী হবে, এভাবে বাকিগুলো। সবাই একসাথে সাজায়, তারপর ভাগগুলো মেলানো হয়।',
        ],
      },
      {
        title: 'কম্বিনেশন (শক্তিশালী থেকে)',
        points: [
          'ট্রয়: একই মানের তিনটি। টেক্কা-টেক্কা-টেক্কা সবচেয়ে ভালো।',
          'কালার রান: একই রঙের পরপর তিনটি।',
          'রান: পরপর তিনটি, রং মিশ্র। টেক্কা-সাহেব-বিবি সবচেয়ে বড়, টেক্কা-২-৩ দ্বিতীয়, তারপর সাহেব-বিবি-গোলাম থেকে ৪-৩-২। সাহেব-টেক্কা-২ রান নয়।',
          'কালার: একই রঙের তিনটি।',
          'পেয়ার: একই মানের দুটি।',
          'ইন্ডি: বাকি সব, সবচেয়ে বড় তাস দিয়ে তুলনা।',
          '৪ তাসের ভাগের মান হলো তার ভেতরের সেরা ৩ তাসের কম্বিনেশন; চতুর্থ তাস শুধু সমান হলে কাজে লাগে।',
        ],
      },
      {
        title: 'শোডাউন ও পয়েন্ট',
        points: [
          'সবার ভাগ ১ মেলানো হয়, তারপর ভাগ ২, এভাবে। সবচেয়ে শক্তিশালী ভাগ সেই দফার সব তাস জেতে। দুটি ভাগ হুবহু সমান হলে যে পরে খেলেছে সে জেতে।',
          'টেক্কা, সাহেব, বিবি, গোলাম ও দশ ১০ পয়েন্ট; নয় থেকে দুই ৫ পয়েন্ট। প্রতি দানে মোট ৩৬০ পয়েন্ট।',
        ],
      },
    ],
  },
};
