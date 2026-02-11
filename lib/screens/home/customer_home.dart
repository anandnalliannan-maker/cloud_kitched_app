import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../models/cart_model.dart';
import '../../services/address_service.dart';
import '../../services/order_service.dart';
import '../customer/customer_add_address.dart';
import '../customer/customer_addresses.dart';
import '../customer/customer_menu.dart';
import '../customer/customer_orders.dart';
import '../customer/customer_profile.dart';
import '../role_select_screen.dart';

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  final _cart = CartModel();
  final _orderService = OrderService();
  final _addressService = AddressService();

  @override
  void dispose() {
    _cart.dispose();
    super.dispose();
  }

  Future<void> _logout() async {
    await FirebaseAuth.instance.signOut();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const RoleSelectScreen()),
        (_) => false,
      );
    }
  }

  Future<void> _placeOrder() async {
    if (_cart.items.isEmpty) return;

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    final deliveryType = await showModalBottomSheet<String>(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.delivery_dining),
                title: const Text('Home Delivery'),
                onTap: () => Navigator.of(context).pop('delivery'),
              ),
              ListTile(
                leading: const Icon(Icons.store),
                title: const Text('Self Pickup'),
                onTap: () => Navigator.of(context).pop('pickup'),
              ),
            ],
          ),
        );
      },
    );

    if (deliveryType == null) return;

    Map<String, dynamic>? selectedAddress;
    if (deliveryType == 'delivery') {
      selectedAddress = await _selectDeliveryAddress(user.uid);
      if (selectedAddress == null) return;
    }

    final items = _cart.items
        .map((item) => {
              'id': item.id,
              'name': item.name,
              'qty': item.quantity,
              'price': item.price,
            })
        .toList();

    try {
      await _orderService.createOrder(
        customerId: user.uid,
        customerPhone: user.phoneNumber ?? 'Unknown',
        items: items,
        total: _cart.total,
        deliveryType: deliveryType,
        deliveryAddress: selectedAddress,
      );

      if (!mounted) return;
      _cart.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Order placed')),
      );
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString().replaceFirst('Bad state: ', '');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Order failed: $msg')),
      );
    }
  }

  Future<Map<String, dynamic>?> _selectDeliveryAddress(String uid) async {
    String? selectedId = await _addressService.getDefaultAddressId(uid);
    if (!mounted) return null;
    List<QueryDocumentSnapshot<Map<String, dynamic>>> cachedDocs = const [];

    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setStateSheet) {
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                  stream: _addressService.watchAddresses(uid),
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const SizedBox(
                        height: 240,
                        child: Center(child: CircularProgressIndicator()),
                      );
                    }

                    final docs = snapshot.data?.docs ?? [];
                    cachedDocs = docs;

                    if (docs.isEmpty) {
                      return Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('No saved address. Add one to continue.'),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed: () async {
                              final created = await Navigator.of(context).push<bool>(
                                MaterialPageRoute(
                                  builder: (_) => const CustomerAddAddressScreen(),
                                ),
                              );
                              if (created == true) {
                                setStateSheet(() {});
                              }
                            },
                            icon: const Icon(Icons.add_location_alt),
                            label: const Text('Add Address'),
                          ),
                        ],
                      );
                    }

                    selectedId ??= docs.first.id;
                    if (!docs.any((d) => d.id == selectedId)) {
                      selectedId = docs.first.id;
                    }

                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Select delivery address',
                          style: TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 12),
                        Flexible(
                          child: ListView.separated(
                            shrinkWrap: true,
                            itemCount: docs.length,
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final doc = docs[index];
                              final data = doc.data();
                              final subtitle = _formatAddress(data);
                              return RadioListTile<String>(
                                value: doc.id,
                                groupValue: selectedId,
                                onChanged: (value) =>
                                    setStateSheet(() => selectedId = value),
                                title: Text((data['name'] ?? 'Address').toString()),
                                subtitle: Text(subtitle),
                              );
                            },
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            OutlinedButton.icon(
                              onPressed: () async {
                                if (docs.length >= 5) {
                                  if (!context.mounted) return;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('You can save up to 5 addresses'),
                                    ),
                                  );
                                  return;
                                }
                                final created =
                                    await Navigator.of(context).push<bool>(
                                  MaterialPageRoute(
                                    builder: (_) => const CustomerAddAddressScreen(),
                                  ),
                                );
                                if (created == true) {
                                  setStateSheet(() {});
                                }
                              },
                              icon: const Icon(Icons.add),
                              label: const Text('Add Address'),
                            ),
                            const Spacer(),
                            FilledButton(
                              onPressed: selectedId == null
                                  ? null
                                  : () {
                                      final selected = cachedDocs.firstWhere(
                                        (doc) => doc.id == selectedId,
                                      );
                                      final data = selected.data();
                                      Navigator.of(context).pop({
                                        'id': selected.id,
                                        ...data,
                                      });
                                    },
                              child: const Text('Use Address'),
                            ),
                          ],
                        ),
                      ],
                    );
                  },
                ),
              ),
            );
          },
        );
      },
    );

    return result;
  }

  String _formatAddress(Map<String, dynamic> data) {
    final flat = (data['flat'] ?? '').toString();
    final apartment = (data['apartment'] ?? '').toString();
    final street = (data['street'] ?? '').toString();
    final area = (data['area'] ?? '').toString();
    final parts = <String>[
      if (flat.isNotEmpty) flat,
      if (apartment.isNotEmpty) apartment,
      if (street.isNotEmpty) street,
      if (area.isNotEmpty) area,
    ];
    return parts.join(', ');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Menu'),
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 16),
              child: AnimatedBuilder(
                animation: _cart,
                builder: (context, _) => Text('Total: INR ${_cart.total}'),
              ),
            ),
          ),
        ],
      ),
      drawer: Drawer(
        child: Column(
          children: [
            const DrawerHeader(
              decoration: BoxDecoration(color: Colors.teal),
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text(
                  'Customer',
                  style: TextStyle(color: Colors.white, fontSize: 18),
                ),
              ),
            ),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  ListTile(
                    leading: const Icon(Icons.person),
                    title: const Text('Profile'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const CustomerProfileScreen(),
                        ),
                      );
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.receipt_long),
                    title: const Text('Order History'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const CustomerOrdersScreen(),
                        ),
                      );
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.location_on),
                    title: const Text('Add Address'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const CustomerAddressesScreen(),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Log out'),
              onTap: _logout,
            ),
          ],
        ),
      ),
      body: CustomerMenuScreen(cart: _cart),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: AnimatedBuilder(
            animation: _cart,
            builder: (context, _) => FilledButton.icon(
              onPressed: _cart.items.isEmpty ? null : _placeOrder,
              icon: const Icon(Icons.shopping_cart_checkout),
              label: Text('Place Order (INR ${_cart.total})'),
            ),
          ),
        ),
      ),
    );
  }
}
