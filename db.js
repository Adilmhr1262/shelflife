/* ShelfLife IndexedDB layer.
   Database: shelflife-db, version 1.
   Object store: products, key path id.
   Every function rejects with an Error on failure, so callers can show
   a visible error instead of reporting a false success. */
(function (global) {
  'use strict';

  var DB_NAME = 'shelflife-db';
  var DB_VERSION = 1;
  var STORE = 'products';

  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      var request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = function (event) {
        resolve(event.target.result);
      };
      request.onerror = function () {
        reject(new Error('Could not open the ShelfLife database: ' + (request.error ? request.error.message : 'unknown error')));
      };
      request.onblocked = function () {
        reject(new Error('The ShelfLife database is blocked by another open tab. Close other ShelfLife tabs and try again.'));
      };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function runStore(mode, work) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE, mode);
        } catch (err) {
          reject(new Error('Database transaction failed: ' + err.message));
          return;
        }
        var store = tx.objectStore(STORE);
        var result;
        try {
          result = work(store);
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () {
          reject(new Error('Database write failed: ' + (tx.error ? tx.error.message : 'unknown error')));
        };
        tx.onabort = function () {
          reject(new Error('Database write was aborted: ' + (tx.error ? tx.error.message : 'unknown error')));
        };
      });
    });
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        reject(new Error('Database request failed: ' + (request.error ? request.error.message : 'unknown error')));
      };
    });
  }

  function getAllProducts() {
    return openDB().then(function (db) {
      var tx = db.transaction(STORE, 'readonly');
      var store = tx.objectStore(STORE);
      return requestToPromise(store.getAll());
    });
  }

  function putProduct(product) {
    return runStore('readwrite', function (store) {
      return requestToPromise(store.put(product));
    }).then(function () { return product; });
  }

  function deleteProduct(id) {
    return runStore('readwrite', function (store) {
      return requestToPromise(store.delete(id));
    });
  }

  /* Delete every product in one transaction. */
  function clearAllProducts() {
    return runStore('readwrite', function (store) {
      return requestToPromise(store.clear());
    });
  }

  /* Replace all products in one transaction: clear, then add each record.
     If any add fails, the whole transaction aborts and old data stays. */
  function replaceAllProducts(products) {
    return runStore('readwrite', function (store) {
      var clearReq = store.clear();
      var chain = requestToPromise(clearReq);
      products.forEach(function (product) {
        chain = chain.then(function () { return requestToPromise(store.add(product)); });
      });
      return chain;
    });
  }

  global.ShelfLifeDB = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    openDB: openDB,
    getAllProducts: getAllProducts,
    putProduct: putProduct,
    deleteProduct: deleteProduct,
    clearAllProducts: clearAllProducts,
    replaceAllProducts: replaceAllProducts
  };
})(typeof window !== 'undefined' ? window : globalThis);
