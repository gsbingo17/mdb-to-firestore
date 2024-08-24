# MongoDB to Firestore Replication

This script replicates data from a MongoDB database to a Firestore database. It supports two modes of operation:

- **Migrate:** Performs a one-time migration of data from MongoDB to Firestore.
- **Live:** Sets up a live replication using MongoDB change streams to continuously synchronize data between the two databases. This includes:
    - **Initial Migration:** A one-time migration of existing data from MongoDB to Firestore.
    - **Incremental Replication:** Uses MongoDB change streams to continuously synchronize data between the two databases, replicating any new changes made after the initial migration.

## Prerequisites

- Node.js (version 14 or later recommended)
- MongoDB server running and accessible
- **MongoDB server configured to allow change streams (requires MongoDB 3.6 or later)** 
- Google Cloud project with Firestore enabled
- Service account with permissions to access Firestore (see [https://cloud.google.com/iam/docs/creating-managing-service-accounts](https://cloud.google.com/iam/docs/creating-managing-service-accounts))

## Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/gsbingo17/mdb-to-firestore.git
   ```

2. Install dependencies:

   ```bash
   cd mdb-to-firestore
   npm install
   ```
## Configuration

Create a replication_config.json file: This file defines the replication settings, including the MongoDB and Firestore connection details and the collections to replicate. Here's an example:
   ```json
   {
     "databasePairs": [
       {
         "source": {
           "connectionString": "mongodb://your-mongodb-host:27017",
           "database": "your-mongodb-database"
         },
         "target": {
           "projectId": "your-firestore-project-id",
           "databaseId": "your-firestore-database-id",
           "collections": [
             {
               "sourceCollection": "your-mongodb-collection",
               "targetCollection": "your-firestore-collection"
             },
             // ... more collections to replicate ...
           ]
         }
       },
       // ... more database pairs to replicate ...
     ],
    "saveThreshold": 100 // Number of changes before saving resume token
   }
   ```
    * databasePairs: An array of objects, each defining a source MongoDB database and a target Firestore database to replicate. 
    * connectionString: The MongoDB connection string. 
    * database: The name of the MongoDB database. 
    * projectId: The ID of your Google Cloud project. 
    * databaseId: The ID of your Firestore database (usually "(default)"). 
    * collections: An array of objects, each defining a source MongoDB collection and a target Firestore collection to replicate. 
    * saveThreshold: The number of changes to process before saving the resume token (for live replication).

## Usage

1. Migrate Mode:

   To perform a one-time migration of data from MongoDB to Firestore, run the script with the migrate argument:

   ```bash
   node index.js migrate
   ```

2. Live Mode:

   To set up live replication using MongoDB change streams, run the script with the live argument:

   ```bash
   node index.js live
   ```

   The script will continuously listen for changes in the specified MongoDB collections and replicate them to Firestore.

## Notes
* The script converts MongoDB's _id field (which is an ObjectId) to a string before storing it in Firestore.
* The saveThreshold parameter in the replication_config.json file controls how often the resume token is saved during live replication. Adjust this value to balance performance and the risk of data loss in case of failures.
* For live replication, the script saves resume tokens to files named resumeToken-{database}-{collection}.json. These files allow the replication process to resume from the last processed change in case of interruptions.
* Implement robust error handling and retry mechanisms in the changeStream.on('error', ...) handler to make your live replication more resilient.
