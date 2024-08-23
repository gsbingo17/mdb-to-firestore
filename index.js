import { MongoClient } from 'mongodb';
import { Firestore } from '@google-cloud/firestore';
import fs from 'fs'; // Use fs/promises for easier async/await

// Load replication configuration from JSON file
const config = JSON.parse(fs.readFileSync('replication_config.json', 'utf8'));

// Function to perform one-time migration for a collection
async function migrateCollection(sourceDb, targetDb, collectionConfig) {
  try {
    const sourceCollection = sourceDb.collection(collectionConfig.sourceCollection);
    const targetCollection = targetDb.collection(collectionConfig.targetCollection);

    console.log(`Migrating collection: ${sourceDb.databaseName}.${collectionConfig.sourceCollection} to ${targetDb.databaseId}.${collectionConfig.targetCollection}`);

    const cursor = sourceCollection.find();

    while (await cursor.hasNext()) {
      let doc = await cursor.next();
      doc = convertIdToString(doc);
      const ref = targetCollection.doc(doc._id);
      delete doc._id;
      await ref.set(doc);
    }

    console.log(`Migration for ${sourceCollection.collectionName} completed successfully!`);
  } catch (error) {
    console.error(`Error migrating collection ${collectionConfig.sourceCollection}:`, error);
  }
}

// Function to start live replication (using change streams) for a collection
async function startLiveReplication(sourceDb, targetDb, collectionConfig, resumeToken = null, resumeTokenFilePath) {
  try {
    const sourceCollection = sourceDb.collection(collectionConfig.sourceCollection);
    const targetCollection = targetDb.collection(collectionConfig.targetCollection);

    console.log(`Starting live replication for: ${sourceDb.databaseName}.${collectionConfig.sourceCollection} to ${targetDb.databaseId}.${collectionConfig.targetCollection}`);

    // Start the change stream, optionally with a resume token
    const changeStreamOptions = resumeToken ? { startAfter: resumeToken } : {};
    const changeStream = sourceCollection.watch({ fullDocument: 'updateLookup' }, changeStreamOptions);

    // Perform the initial migration only if there's no resume token
    if (!resumeToken) {
      console.log("I am here");
      await migrateCollection(sourceDb, targetDb, collectionConfig);
    }

    let changeCount = 0;
     // Get saveThreshold from the config file
     const saveThreshold = config.saveThreshold;

    // Store the resume token after each change
    changeStream.on('change', async (change) => {
      const operationType = change.operationType;
      const fullDocument = change.fullDocument;
      const documentKey = change.documentKey;

      if (operationType === 'insert') {
        const ref = targetCollection.doc(fullDocument._id.toString());
        delete fullDocument._id;
        await ref.set(fullDocument);
      } else if (operationType === 'update') {
        const ref = targetCollection.doc(fullDocument._id.toString());
        delete fullDocument._id;
        await ref.update(fullDocument);
      } else if (operationType === 'delete') {
        const ref = targetCollection.doc(documentKey._id.toString());
        await ref.delete();
      }

      // Batch Saving (Change Count-Based):
      changeCount++;
      if (changeCount >= saveThreshold) {
        const newResumeToken = changeStream.resumeToken;
        await saveResumeToken(resumeTokenFilePath, newResumeToken);
        changeCount = 0; // Reset the counter
      }

      // Get and store the resume token
      //const newResumeToken = changeStream.resumeToken;
      //await saveResumeToken(resumeTokenFilePath, newResumeToken); 
    });

    changeStream.on('error', (error) => {
      console.error(`Error occurred in change stream for ${sourceCollection.collectionName}:`, error);
      // ... (implement error handling and potentially retry logic)
    });

  } catch (error) {
    console.error(`Error starting live replication for ${collectionConfig.sourceCollection}:`, error);
  }
}

// Function to handle database operations based on the chosen mode
async function processDatabase(sourceConfig, targetConfig, mode) {
  const sourceClient = new MongoClient(sourceConfig.connectionString);
  try {
    const targetClient = new Firestore(targetConfig);

    await sourceClient.connect();
    const sourceDb = sourceClient.db(sourceConfig.database);

    for (const collectionConfig of targetConfig.collections) {
      if (mode === 'migrate') {
        // Only migrate data
        await migrateCollection(sourceDb, targetClient, collectionConfig);
      } else if (mode === 'live') {
        // Perform both migration and live replication
        const resumeTokenFilePath = `resumeToken-${sourceConfig.database}-${collectionConfig.sourceCollection}.json`; // Use a unique path per collection
        const resumeToken = await loadResumeToken(resumeTokenFilePath); 
        console.log(`Resume token for ${sourceConfig.database}.${collectionConfig.sourceCollection}:`, resumeToken);
        await startLiveReplication(sourceDb, targetClient, collectionConfig, resumeToken, resumeTokenFilePath);
      } else {
        console.error(`Invalid mode: ${mode}. Please choose either 'migrate' or 'live'.`);
        process.exit(1); // Exit with an error code
      }
    }
  } catch (error) {
    console.error(`Error processing database ${sourceConfig.database}:`, error);
  } 
  // Don't close the connection here if in 'live' mode
  if (mode === 'migrate') {
    await sourceClient.close();
    console.log(`Connection to ${sourceConfig.database} closed.`);
  }
}

// Function to start the replication/migration process
async function startProcess(mode) {
  try {
    if (!['migrate', 'live'].includes(mode)) {
      console.error(`Invalid mode: ${mode}. Please choose either 'migrate' or 'live'.`);
      process.exit(1); // Exit with an error code
    }

    for (const databasePair of config.databasePairs) {
      await processDatabase(databasePair.source, databasePair.target, mode);
    }
  } catch (error) {
    console.error('Error during process:', error);
  }
}

function convertIdToString(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;

  for (const key in obj) {
    if (key === '_id') {
      obj[key] = obj[key].toString();
    } else if (typeof obj[key] === 'object') {
      convertIdToString(obj[key]);
    }
  }
  return obj;
}

// Function to load resume token from a file
async function loadResumeToken(filePath) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(data).resumeToken;
  } catch (error) {
    // If the file doesn't exist, create a new one with a null resume token
    if (error.code === 'ENOENT') { 
      console.log(`Resume token file not found. Creating a new one at ${filePath}`);
      await saveResumeToken(filePath, null); // Create a new file with null token
      return null; 
    } else {
      console.error(`Error loading resume token from ${filePath}:`, error);
      throw error; // Re-throw other errors for handling elsewhere
    }
  }
}

// Function to save resume token to a file
async function saveResumeToken(filePath, resumeToken) {
  try {
    await fs.promises.writeFile(filePath, JSON.stringify({ resumeToken }), 'utf8');
  } catch (error) {
    console.error(`Error saving resume token to ${filePath}:`, error);
    // ... (handle error appropriately)
  }
}

// Get the desired mode from command line arguments
const mode = process.argv[2] || 'migrate'; // Default to 'migrate' if not provided

startProcess(mode);
