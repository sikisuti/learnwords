# Learn Words application

This is an application supporting members improving their vocabulary in a foreign language.

## Technology stack

- SQLite for database
- Node.js + Fastify for service layer containing the business logic and provides also the static built frontend code.
- Angular for the frontend

## Technical considerations for the application

- Should accessible via browser.
- Should run on Raspberry Pi 3 model B v1.2 running Raspberry Pi OS (Debian), meaning the available resources will be limited.
- Has to store data in the most lightweight manner.
- The stored data has to be able to backup, so the database layer should be separated from the application logic and UI.
- The business logic is relatively simple, mostly containing database queries. This would also help keeping the implementation simple and lightweight.

## Functional requirements

### Authentication

- The application should handle users separately. 
- The user should login in order to use functionalities.
- The credentials should be username and password.
- There should be a way to register as a user.

### Persistance layer

- User table: Stores information about the users for the authentication and specific user settings.
- Word table: Stores words, phrases, sentences with their details:
  - native: text
  - foreign: text
  - definition: text (explain the word)
  - example: text
  - pronunciation: text
  - level_id: foreign key to levels
  - lexical_category: text (verb, noun, etc.)
- Each word has a level attached in which language level the word is used (A1 - elementary, A2 - pre-intermediate, B1 - intermediate, B2 - upper intermediate, C1 - advanced, C2 - proficient). There should be an extra 7th level for the manually inserted words that doesn't have level information at the insert time.
- The progress of learning a word goes through stages. There are 6 stages (1-6). 1 - newly added word for a user to learn, 6 - word is known by the user, and in between.
- user_word table: Stores how each user progressing with each words learning. Which user is on what stage for a word.
  - user_id: foreign key to user
  - word_id: foreign key to word
  - stage: integer (1-6 stage for a word for a user)
  - last_learned: timestamp (time when the word went to the stage)  

### Main purpose

The database stores words, phrases, sentences with their translated counterpart, pronunciation, usage example. The application collects a bunch of words at a time and provide them one by one for the user helping to memorize them. After the user went through the bunch of words to memorize, the words' stages for that particular user increasing by one. 

### Learning steps

1. User initiates a learning session
2. The application queries a configurable number of words prepared for the user to learn. This query considers a learning schedule defined separately.
3. The user goes through an implemented learning process for the bunch of words.
4. When the learning process finished, the stages of the words incremented for that particular user.

### Learning process

A bunch of words goes through 10 turns.

1. Shuffle the bunch of words and show the native version of the shuffled words one by one three times (3 turns)
2. Shuffle the bunch of words and show the foreign version of the shuffled words one by one three times (3 turns)
3. Shuffle the bunch of words and randomly select one by one native or foreign version to show then go through the bunch again but this time show the other native or foreign version. If previously native was shown, show foreign and the other way round. Do this step two times. (2*2 turns)

### Learning schedule

Every time a word goes through a learning session by a user, the time of the stage increase stored. The durations between the words allowed to go to the next stage are pre-defined.

- 1 -> 2: any time (this is when the user meets the word first time)
- 2 -> 3: at least 3 days elapse
- 3 -> 4: at least 1 week elapses
- 4 -> 5: at least 2 weeks elapse
- 5 -> 6: at least 1 month elapses

After the word for a user reaches the 6th stage, it's known so it will never come back to learn again for that particular user.

## Design requirements

The application mainly used with browsers running on smart phone devices. Design the layout accordingly.

### Login screen

Being able to login or go to register page.

### Register page

Being able to register as a new user

### Home screen

Shows who is logged in and buttons to start a learning session and add a new word.

### Learning screen

The bunch of word visualized like a deck of cards. The cards have 2 sides with the native and foreign as the content. The cards are shown one after the other. The cards should be able to flip, swipe to different directions through animation. 

The card shoud support guestures:
- swipe right: put the card to the bottom of the deck (repeat word in the same turn)
- swipe down: get the word out from the deck for this turn
- tap/click on the card: flip the card and show the other side. If native was previously show foreign and the other way round.

Once a user went through a learning session process on a deck of cards, the words' stages increased by one and navigate back to home screen.