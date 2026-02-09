import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class MenuService {
  MenuService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> get _menuRef =>
      _firestore.collection('menu_items');

  Stream<QuerySnapshot<Map<String, dynamic>>> watchMenu() {
    return _menuRef.orderBy('createdAt', descending: true).snapshots();
  }

  Future<void> addMenuItem({
    required String name,
    required String description,
    required int quantity,
    required int price,
    required bool enabled,
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('User not signed in');
    }

    await _menuRef.add({
      'name': name,
      'description': description,
      'quantity': quantity,
      'price': price,
      'enabled': enabled,
      'createdBy': uid,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateMenuItem(
    String id, {
    required String name,
    required String description,
    required int quantity,
    required int price,
    required bool enabled,
  }) {
    return _menuRef.doc(id).update({
      'name': name,
      'description': description,
      'quantity': quantity,
      'price': price,
      'enabled': enabled,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> toggleEnabled(String id, bool enabled) {
    return _menuRef.doc(id).update({
      'enabled': enabled,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> deleteMenuItem(String id) {
    return _menuRef.doc(id).delete();
  }
}
